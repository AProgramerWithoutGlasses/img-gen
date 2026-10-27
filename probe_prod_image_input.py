"""Run one explicitly selected production-input diagnostic, without retries.

Run on the production host. Inputs and generated pictures never leave that host.
Only safe metadata is printed; credentials, prompts and raw responses are not saved.
Each case creates an exclusive evidence file BEFORE making a potentially paid call.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def sql(query):
    command = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --max-allowed-packet=128M --default-character-set=utf8mb4 -uroot -D imggen -N -B -e '
    result = subprocess.run(
        ['docker', 'exec', 'img-gen-mysql', 'sh', '-c', command + "'" + query + "'"],
        capture_output=True, check=True)
    return result.stdout.decode().strip().split('\t')


def jpeg_end(data):
    if not data.startswith(b'\xff\xd8'):
        raise ValueError('Expected JPEG input')
    i = 2
    while i < len(data):
        if data[i] != 255:
            i += 1
            continue
        start = i
        while i < len(data) and data[i] == 255:
            i += 1
        if i >= len(data):
            break
        marker = data[i]
        i += 1
        if marker == 217:
            return i
        if marker in (0, 1, 216) or 208 <= marker <= 215:
            continue
        length = int.from_bytes(data[i:i + 2], 'big')
        if length < 2 or i + length > len(data):
            raise ValueError('Invalid JPEG segment at ' + str(start))
        i += length
    raise ValueError('Missing JPEG end marker')


def transcode(data, resize):
    command = ['ffmpeg', '-v', 'error', '-threads', '1', '-f', 'image2pipe', '-i', 'pipe:0', '-frames:v', '1']
    if resize:
        command += ['-vf', 'scale=2048:2048:force_original_aspect_ratio=decrease']
    command += ['-map_metadata', '-1', '-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj420p', '-threads', '1', '-f', 'image2pipe', 'pipe:1']
    return subprocess.run(command, input=data, capture_output=True, check=True).stdout


def image_metadata(data):
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-show_entries',
         'stream=codec_name,width,height,pix_fmt', '-of', 'json'],
        input=data, capture_output=True, check=True)
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'streams': json.loads(result.stdout).get('streams', [])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    parser.add_argument('--case', required=True, choices=[
        'original-dual', 'trim-dual', 'reencode-dual', 'resize2048-dual', 'original-single'])
    parser.add_argument('--evidence-dir', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{32}', args.job):
        raise SystemExit('Invalid job ID')
    os.umask(0o077)
    directory = Path(args.evidence_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / (args.case + '.json')
    if target.exists():
        raise SystemExit('Evidence exists; refusing to repeat a potentially billed call')
    fields = sql('SELECT HEX(input_image),HEX(reference_image),HEX(effective_prompt),model FROM jobs WHERE id="' + args.job + '";')
    if len(fields) != 4 or fields[3] != 'gpt-image-2':
        raise SystemExit('Expected one GPT Image 2 job')
    inputs = [bytes.fromhex(fields[0]), bytes.fromhex(fields[1])]
    prompt = bytes.fromhex(fields[2])
    if inputs[0] != inputs[1]:
        raise SystemExit('This controlled experiment expects identical source images')
    if args.case == 'trim-dual':
        inputs = [data[:jpeg_end(data)] for data in inputs]
    elif args.case in ('reencode-dual', 'resize2048-dual'):
        converted = transcode(inputs[0], args.case == 'resize2048-dual')
        inputs = [converted, converted]
    elif args.case == 'original-single':
        inputs = inputs[:1]
    config = {}
    for line in Path('/opt/img-gen/.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            config[key.strip()] = value.strip().strip('\"\'')
    base = config.get('QISO_BASE_URL', 'https://api.qiso.io').rstrip('/')
    if urllib.parse.urlparse(base).scheme != 'https':
        raise SystemExit('Expected configured HTTPS upstream')
    boundary = 'InputDiagnostic' + uuid.uuid4().hex
    parts = []
    for name, value in [('model', b'gpt-image-2'), ('prompt', prompt)]:
        parts.extend([('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n').encode(), value, b'\r\n'])
    field = 'image' if len(inputs) == 1 else 'image[]'
    for i, data in enumerate(inputs):
        parts.extend([('--' + boundary + '\r\nContent-Disposition: form-data; name="' + field + '"; filename="input-' + str(i + 1) + '.jpg"\r\nContent-Type: image/jpeg\r\n\r\n').encode(), data, b'\r\n'])
    parts.append(('--' + boundary + '--\r\n').encode())
    body = b''.join(parts)
    result = {'case': args.case, 'source_job': args.job, 'model': 'gpt-image-2',
              'endpoint': '/v1/images/edits', 'upstream_host': urllib.parse.urlparse(base).hostname,
              'prompt_sha256': hashlib.sha256(prompt).hexdigest(), 'field': field,
              'inputs': [image_metadata(data) for data in inputs], 'request_bytes': len(body),
              'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'state': 'started'}
    with target.open('x') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result), flush=True)
    started = time.monotonic()
    request = urllib.request.Request(base + '/v1/images/edits', data=body, headers={
        'Authorization': 'Bearer ' + config['QISO_API_KEY'],
        'Content-Type': 'multipart/form-data; boundary=' + boundary})
    # Do not follow redirects with credentials or image content.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        try:
            response = urllib.request.build_opener(NoRedirect()).open(request, timeout=300)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result['status'] = response.status
            request_id = response.headers.get('X-Request-Id', response.headers.get('Request-Id', ''))
            result['request_id'] = request_id[:160] if re.fullmatch(r'[A-Za-z0-9_:\-.]*', request_id) else ''
            raw = response.read(72 * 1024 * 1024 + 1)
        result['response_bytes'] = len(raw)
        if len(raw) > 72 * 1024 * 1024:
            raise ValueError('Response limit exceeded')
        payload = json.loads(raw)
        error_text = json.dumps(payload.get('error', {}))
        # Classify known errors without saving the raw upstream error or prompt.
        result['invalid_input_image'] = 'Invalid input image file' in error_text
        result['images'] = []
        for i, item in enumerate(payload.get('data', [])):
            if not item.get('b64_json'):
                continue
            data = base64.b64decode(item['b64_json'], validate=True)
            metadata = image_metadata(data)
            filename = args.case + '-result-' + str(i) + '.image'
            (directory / filename).write_bytes(data)
            result['images'].append({**metadata, 'server_file': filename})
        result['state'] = 'completed'
    except Exception as error:
        result['state'] = 'failed_without_retry'
        result['exception_type'] = type(error).__name__
    result['elapsed_seconds'] = round(time.monotonic() - started, 2)
    target.write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
