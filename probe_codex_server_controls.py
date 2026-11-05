"""Run explicit single-shot Codex controls from the existing Sub2API host.

Requires existing Docker, psql, requests and authorized server access. Credentials
are read via a read-only SQL session and used only in memory on that server.
Never prints tokens, proxy credentials, full responses, or generated images.
Default is dry-run; --execute is required. Existing records block replay.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import time
from urllib.parse import quote
import uuid

PROMPT = 'Generate one studio photograph of a red ceramic teapot beside a blue cube on a gray table.'
CASES = ('responses_invalid_tool', 'responses_valid', 'responses_effort_high', 'images_valid', 'images_invalid')
FIELDS = ('type', 'model', 'action', 'size', 'quality', 'background', 'output_format')


def request_body(case):
    if case.startswith('images_'):
        return 'images/generations', {'model': 'gpt-image-2', 'prompt': PROMPT,
            'size': 'INVALID' if case == 'images_invalid' else '1024x1536',
            'quality': 'INVALID' if case == 'images_invalid' else 'high'}
    body = {'model': 'gpt-5.6-luna', 'instructions': '', 'store': False, 'stream': True,
            'input': [{'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': PROMPT}]}],
            'tools': [{'type': 'image_generation', 'action': 'generate', 'model': 'gpt-image-2',
                       'size': '1024x1536', 'quality': 'high'}],
            'tool_choice': {'type': 'image_generation'}}
    if case == 'responses_invalid_tool':
        body['tools'][0].update(model='not-a-real-image-model', size='INVALID', quality='INVALID')
    if case == 'responses_effort_high':
        body['reasoning'] = {'effort': 'high'}
    return 'responses', body


def credentials(account_id):
    config = json.loads(subprocess.check_output(['docker', 'inspect', 'sub2api']))[0]
    values = dict(s.split('=', 1) for s in config['Config']['Env'])
    env = dict(os.environ, PGHOST=values['DATABASE_HOST'], PGPORT=values.get('DATABASE_PORT', '5432'),
        PGUSER=values['DATABASE_USER'], PGDATABASE=values['DATABASE_DBNAME'],
        PGPASSWORD=values['DATABASE_PASSWORD'],
        PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000')
    query = ("SELECT json_build_object('credentials',a.credentials,'proxy',row_to_json(p)) "
             'FROM accounts a LEFT JOIN proxies p ON p.id=a.proxy_id WHERE a.id=' + str(account_id))
    row = json.loads(subprocess.check_output(['psql', '-XAt', '-c', query], env=env))
    return row['credentials'], row['proxy']


def run(case, output, account_id, credential, proxy, ua, originator='codex_cli_rs', version=None):
    import requests
    endpoint, body = request_body(case)
    record = {'case': case, 'account_id': account_id, 'proxy_id': proxy['id'],
              'endpoint': 'https://chatgpt.com/backend-api/codex/' + endpoint,
              'request': body, 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'state': 'started', 'images': [], 'lifecycle': []}
    record['client_identity'] = {'user_agent': ua, 'originator': originator, 'version': version}
    target = output / (case + '.json')
    with target.open('x', encoding='utf-8') as f:
        json.dump(record, f, indent=2)
    print(json.dumps({'started': case, 'account_id': account_id}), flush=True)
    start = time.monotonic()
    seen = set()

    def collect(payload):
        if payload.get('type'):
            record.setdefault('events', []).append(payload['type'])
        response = payload.get('response', payload)
        if 'data' in response:
            record['image_response_metadata'] = {k: response[k] for k in
                ('model', 'size', 'quality', 'output_format', 'background', 'usage') if k in response}
        if response.get('object') == 'response' or response.get('tools'):
            record['lifecycle'].append({k: response[k] for k in ('id', 'model', 'status', 'reasoning') if k in response})
            record['declared_tools'] = [{k: t[k] for k in FIELDS if k in t}
                for t in response.get('tools', []) if t.get('type') == 'image_generation']
        error = response.get('error') or (payload if payload.get('type') == 'error' else None)
        if isinstance(error, dict):
            record['error'] = {k: error[k] for k in ('type', 'code', 'message') if k in error}
        items = list(response.get('output', [])) + list(response.get('data', []))
        if isinstance(payload.get('item'), dict):
            items.append(payload['item'])
        for item in items:
            encoded = item.get('result') or item.get('b64_json')
            if not encoded:
                continue
            blob = base64.b64decode(encoded, validate=True)
            digest = hashlib.sha256(blob).hexdigest()
            if digest in seen:
                continue
            seen.add(digest)
            info = {k: item[k] for k in FIELDS if k in item}
            info.update(bytes=len(blob), sha256=digest)
            if blob[:8] == b'\x89PNG\r\n\x1a\n':
                info['width'], info['height'] = struct.unpack('>II', blob[16:24])
            record['images'].append(info)

    proxy_url = '{}://{}:{}@{}:{}'.format(proxy['protocol'], quote(proxy.get('username') or '', safe=''),
        quote(proxy.get('password') or '', safe=''), proxy['host'], proxy['port'])
    headers = {'Authorization': 'Bearer ' + credential['access_token'], 'Content-Type': 'application/json',
        'ChatGPT-Account-ID': credential['chatgpt_account_id'], 'User-Agent': ua, 'originator': originator,
        'Accept': 'text/event-stream' if endpoint == 'responses' else 'application/json',
        'X-Request-ID': 'imggen-official-' + str(uuid.uuid4())}
    if version:
        headers['version'] = version
    session = requests.Session()
    session.trust_env = False
    session.proxies = {'https': proxy_url}
    try:
        with session.post(record['endpoint'], headers=headers, json=body, timeout=(25, 240),
                          stream=True, allow_redirects=False) as response:
            record['http_status'] = response.status_code
            record['headers'] = {k: response.headers[k] for k in
                ('x-request-id', 'x-codex-imagegen-request-id', 'content-type', 'content-encoding', 'server', 'cf-ray') if k in response.headers}
            # Read public TLS certificate identity; requests still verifies the certificate.
            connection = getattr(response.raw, 'connection', None)
            sock = getattr(connection, 'sock', None)
            if sock is not None:
                cert = sock.getpeercert()
                record['tls'] = {k: cert.get(k) for k in ('subject', 'issuer', 'notAfter')}
            chunks, total = [], 0
            # iter_content decodes HTTP gzip/deflate; raw.read does not by default.
            for chunk in response.iter_content(65536):
                total += len(chunk)
                if total > 100 * 1024 * 1024:
                    raise ValueError('response limit')
                chunks.append(chunk)
            blob = b''.join(chunks)
            if 'text/event-stream' in response.headers.get('content-type', '') or blob.lstrip().startswith((b'data:', b'event:')):
                for line in blob.splitlines():
                    if line.startswith(b'data:') and line[5:].strip() != b'[DONE]':
                        collect(json.loads(line[5:]))
            else:
                try:
                    payload = json.loads(blob)
                except ValueError:
                    record['non_json_response_bytes'] = len(blob)
                    record['non_json_prefix_hex'] = blob[:16].hex()
                else:
                    record['json_top_level_keys'] = list(payload) if isinstance(payload, dict) else []
                    collect(payload)
        record['state'] = 'success' if record.get('http_status') == 200 and record['images'] else 'failed'
    except Exception as exc:
        record['state'] = 'failed'
        # Exception strings can include authenticated proxy URLs; never print them.
        record['transport_error_type'] = type(exc).__name__
    finally:
        session.close()
    record['elapsed_seconds'] = round(time.monotonic() - start, 2)
    # Scrub known credentials even if an upstream error echoed them.
    text = json.dumps(record, ensure_ascii=False, indent=2)
    for secret in (credential.get('access_token'), credential.get('refresh_token'), proxy.get('password'), proxy_url):
        if secret:
            text = text.replace(secret, '[REDACTED]')
    target.write_text(text, encoding='utf-8')
    summary = json.loads(text)
    summary.pop('request', None)
    print(json.dumps(summary, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cases', nargs='+', choices=CASES)
    parser.add_argument('--account', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--user-agent', default='codex-tui/0.146.0 (Ubuntu 22.4.0; x86_64) xterm-256color')
    parser.add_argument('--originator', default='codex-tui')
    parser.add_argument('--version', default='0.146.0')
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if len(set(args.cases)) != len(args.cases) or args.account < 1:
        parser.error('invalid account or duplicate cases')
    if not args.execute:
        print(json.dumps({c: request_body(c) for c in args.cases}, indent=2))
        return
    os.umask(0o077)
    args.output.mkdir(parents=True, mode=0o700, exist_ok=True)
    if any((args.output / (c + '.json')).exists() for c in args.cases):
        parser.error('existing record blocks replay')
    credential, proxy = credentials(args.account)
    for case in args.cases:
        run(case, args.output, args.account, credential, proxy, args.user_agent, args.originator, args.version)


if __name__ == '__main__':
    main()
