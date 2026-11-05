"""Explicit, single-shot image-control experiments; no automatic retries.

Default is a dry run. Credentials use probe_image_clarity.configuration().
Only allowlisted metadata and decoded images are saved, never full responses.
Each case is reserved before sending so interruptions cannot cause replays.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image
from probe_image_clarity import configuration

PROMPT = ('Generate one studio product photograph of a red ceramic teapot beside '
          'a blue cube and a white card reading TEST 0123456789 on a gray table. '
          'All three objects fully visible, sharp focus, neutral lighting.')
GPT_MODELS = {'gpt2': 'gpt-image-2', 'gpt15': 'gpt-image-1.5',
              'sunburst': 'gpt-image-2.5-sunburst', 'flare': 'gpt-image-2.5-flare',
              'gpt1': 'gpt-image-1'}
GEMINI_MODELS = {'flash': 'gemini-3.1-flash-image', 'pro': 'gemini-3-pro-image'}


def cases():
    result = {}
    for label, model in GPT_MODELS.items():
        for variant, fields in {
            'default': {}, 'square': {'size': '1024x1024'},
            'portrait': {'size': '1024x1536'}, 'large': {'size': '3840x2160'},
            'low': {'size': '1024x1024', 'quality': 'low'},
            'high': {'size': '1024x1024', 'quality': 'high'},
            'xhigh': {'size': '2048x2048', 'quality': 'xhigh'},
            'prompt_quality_high': {'prompt': PROMPT + ' Use the highest image generation quality and maximum rendering effort. Set image tool quality to high.'},
            'invalid': {'size': 'INVALID', 'quality': 'INVALID', 'reasoning_effort': 'INVALID'},
            'effort_high': {'reasoning_effort': 'high'},
            'prompt_portrait': {'prompt': PROMPT + ' Use a tall portrait canvas with aspect ratio 9:16.'},
            'prompt_4k': {'prompt': PROMPT + ' Use a 3840 by 2160 pixel canvas, 4K resolution, aspect ratio 16:9.'},
        }.items():
            result[label + '_' + variant] = ('/v1/images/generations',
                {'model': model, 'prompt': PROMPT, **fields})
    for label, model in GEMINI_MODELS.items():
        for variant, image_cfg, thinking in [
            ('square_1k', {'aspectRatio': '1:1', 'imageSize': '1K'}, None),
            ('square_2k', {'aspectRatio': '1:1', 'imageSize': '2K'}, None),
            ('square_4k', {'aspectRatio': '1:1', 'imageSize': '4K'}, None),
            ('portrait_1k', {'aspectRatio': '9:16', 'imageSize': '1K'}, None),
            ('portrait_2k', {'aspectRatio': '9:16', 'imageSize': '2K'}, None),
            ('square_512', {'aspectRatio': '1:1', 'imageSize': '512'}, None),
            ('classic_1k', {'aspectRatio': '4:3', 'imageSize': '1K'}, None),
            ('wide_1k', {'aspectRatio': '21:9', 'imageSize': '1K'}, None),
            ('landscape_2k', {'aspectRatio': '16:9', 'imageSize': '2K'}, None),
            ('low', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingLevel': 'low', 'includeThoughts': True}),
            ('high', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingLevel': 'high', 'includeThoughts': True}),
            ('minimal', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingLevel': 'minimal', 'includeThoughts': True}),
            ('medium', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingLevel': 'medium', 'includeThoughts': True}),
            ('high_2k', {'aspectRatio': '1:1', 'imageSize': '2K'}, {'thinkingLevel': 'high', 'includeThoughts': True}),
            ('high_2k_hidden', {'aspectRatio': '1:1', 'imageSize': '2K'}, {'thinkingLevel': 'high', 'includeThoughts': False}),
            ('invalid_thinking', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingLevel': 'INVALID'}),
            ('budget0', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingBudget': 0, 'includeThoughts': True}),
            ('budget8192', {'aspectRatio': '1:1', 'imageSize': '1K'}, {'thinkingBudget': 8192, 'includeThoughts': True}),
            ('invalid_size', {'aspectRatio': '1:1', 'imageSize': 'INVALID'}, None),
            ('invalid_ratio', {'aspectRatio': 'INVALID', 'imageSize': '1K'}, None),
        ]:
            config = {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': image_cfg}
            if thinking is not None:
                config['thinkingConfig'] = thinking
            result[label + '_' + variant] = (f'/v1beta/models/{model}:generateContent', {
                'contents': [{'role': 'user', 'parts': [{'text': PROMPT}]}], 'generationConfig': config})
    for label, effort, include in [('minimal', 'minimal', True), ('high', 'high', True), ('high_hidden', 'high', False)]:
        result['flash_chat_' + label] = ('/v1/chat/completions', {
            'model': 'gemini-3.1-flash-image', 'messages': [{'role': 'user', 'content': PROMPT}],
            'stream': False, 'extra_body': {'google': {
                'image_config': {'aspect_ratio': '1:1', 'image_size': '2K'},
                'thinking_config': {'thinking_level': effort, 'include_thoughts': include}}}})
    for main_model in ['gpt-5.5', 'gpt-5.6-luna', 'gpt-6-sol']:
        for variant, effort, size, quality in [
            ('low', 'low', '1024x1024', 'low'),
            ('high', 'high', '1024x1024', 'high'),
            ('effort_high_quality_low', 'high', '1024x1024', 'low'),
            ('effort_low_quality_high', 'low', '1024x1024', 'high'),
            ('portrait', 'low', '1024x1536', 'low'),
            ('large', 'high', '3840x2160', 'high'),
            ('invalid_effort', 'INVALID', '1024x1024', 'low'),
        ]:
            result['responses_' + main_model + '_' + variant] = ('/v1/responses', {
                'model': main_model, 'input': PROMPT, 'stream': False, 'store': False,
                'reasoning': {'effort': effort},
                'tools': [{'type': 'image_generation', 'model': 'gpt-image-2', 'size': size, 'quality': quality}],
                'tool_choice': {'type': 'image_generation'}})
    result['responses_minimal_tool'] = ('/v1/responses', {
        'model': 'gpt-5.6-luna', 'input': PROMPT, 'store': False, 'stream': True,
        'reasoning': {'effort': 'low'}, 'tools': [{'type': 'image_generation'}],
        'tool_choice': {'type': 'image_generation'}})
    result['responses_text_control'] = ('/v1/responses', {
        'model': 'gpt-5.6-luna', 'input': 'Reply with exactly OK.', 'store': False,
        'stream': True, 'reasoning': {'effort': 'low'}})
    for label, driver, image_model, effort in [
        ('sunburst_high', 'gpt-5.6-luna', 'gpt-image-2.5-sunburst', 'high'),
        ('no_reasoning', 'gpt-5.6-luna', 'gpt-image-2', None),
        ('none', 'gpt-5.6-luna', 'gpt-image-2', 'none'),
        ('minimal', 'gpt-5.6-luna', 'gpt-image-2', 'minimal'),
        ('medium', 'gpt-5.6-luna', 'gpt-image-2', 'medium'),
        ('xhigh', 'gpt-5.6-luna', 'gpt-image-2', 'xhigh'),
        ('max', 'gpt-5.6-luna', 'gpt-image-2', 'max'),
        ('sol_high', 'gpt-5.6-sol', 'gpt-image-2', 'high'),
    ]:
        body = {'model': driver, 'input': PROMPT, 'store': False, 'stream': True,
                'tools': [{'type': 'image_generation', 'action': 'generate', 'model': image_model,
                           'size': '1024x1024', 'quality': 'high'}],
                'tool_choice': {'type': 'image_generation'}}
        if effort is not None:
            body['reasoning'] = {'effort': effort}
        result['responses_' + label] = ('/v1/responses', body)
    for variant, size in [('portrait', '1024x1536'), ('large', '3840x2160')]:
        body = {'model': 'gpt-5.6-luna', 'input': PROMPT, 'store': False, 'stream': True,
                'tools': [{'type': 'image_generation', 'action': 'generate', 'model': 'gpt-image-2',
                           'size': size, 'quality': 'high'}],
                'tool_choice': {'type': 'image_generation'}}
        result['responses_default_' + variant] = ('/v1/responses', body)
    for driver in ['gpt-5.5', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-6.1-sol']:
        for effort in [None, 'high']:
            body = {'model': driver, 'input': PROMPT, 'store': False, 'stream': True,
                    'tools': [{'type': 'image_generation', 'action': 'generate', 'model': 'gpt-image-2',
                               'size': '1024x1024', 'quality': 'high'}],
                    'tool_choice': {'type': 'image_generation'}}
            if effort is not None:
                body['reasoning'] = {'effort': effort}
            result['driver_' + driver + '_' + (effort or 'default')] = ('/v1/responses', body)
    return result


def run(name, endpoint, body, output, base, key, timeout):
    record = {'case': name, 'endpoint': endpoint, 'request': body,
              'started_at': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
              'state': 'started', 'images': [], 'metadata': {}, 'thought_parts': 0}
    record['base_url'] = base
    record['client_correlation_id'] = 'imggen-controls-' + str(uuid.uuid4())
    record['expected_output'] = 'text' if name == 'responses_text_control' else 'image'
    target = output / (name + '.json')
    with target.open('x', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    print(json.dumps({'started': name}), flush=True)
    start = time.monotonic()
    seen = set()

    def collect(payload):
        if payload.get('type'):
            counts = record.setdefault('event_counts', {})
            counts[payload['type']] = counts.get(payload['type'], 0) + 1
        for field in ('model', 'modelVersion', 'quality', 'size', 'output_format', 'usage',
                      'usageMetadata', 'reasoning', 'status', 'incomplete_details'):
            if field in payload:
                record['metadata'][field] = payload[field]
        if payload.get('object') == 'response' and payload.get('id'):
            record['metadata']['response_id'] = payload['id']
        if isinstance(payload.get('tools'), list):
            record['metadata']['declared_image_tools'] = [
                {field: item[field] for field in ('type', 'model', 'action', 'size', 'quality',
                    'output_format', 'background') if field in item}
                for item in payload['tools'] if item.get('type') == 'image_generation']
        if isinstance(payload.get('error'), dict):
            record['error'] = {k: str(payload['error'][k]).replace(key, '[REDACTED]')[:1000]
                               for k in ('type', 'code', 'message') if k in payload['error']}
        elif payload.get('type') == 'error':
            record['error'] = {k: str(payload[k]).replace(key, '[REDACTED]')[:1000]
                               for k in ('type', 'code', 'message') if k in payload}
        if isinstance(payload.get('response'), dict):
            collect(payload['response'])
        image_data = []
        for choice in payload.get('choices', []):
            message = choice.get('message', {})
            for field in ('content', 'images'):
                content = message.get(field)
                if content:
                    for encoded in re.findall(r'data:image/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)',
                                              json.dumps(content, ensure_ascii=False)):
                        image_data.append((encoded, None))
        for item in payload.get('data', []):
            if item.get('b64_json'):
                image_data.append((item['b64_json'], False))
            for field in ('size', 'quality', 'output_format'):
                if field in item:
                    record['metadata']['item_' + field] = item[field]
        output_items = payload.get('output', [])
        if isinstance(payload.get('item'), dict):
            output_items = output_items + [payload['item']]
        for item in output_items:
            if item.get('type') == 'image_generation_call':
                if item.get('result'):
                    image_data.append((item['result'], False))
                for field in ('size', 'quality', 'output_format', 'model', 'status'):
                    if field in item:
                        record['metadata']['tool_' + field] = item[field]
        for candidate in payload.get('candidates', []):
            if 'finishReason' in candidate:
                record['metadata']['finishReason'] = candidate['finishReason']
            for part in candidate.get('content', {}).get('parts', []):
                if part.get('thought'):
                    record['thought_parts'] += 1
                inline = part.get('inlineData') or part.get('inline_data') or {}
                if inline.get('data'):
                    image_data.append((inline['data'], bool(part.get('thought'))))
        for encoded, thought in image_data:
            blob = base64.b64decode(encoded, validate=True)
            digest = hashlib.sha256(blob).hexdigest()
            identity = (digest, thought)
            if identity in seen:
                continue
            seen.add(identity)
            with Image.open(io.BytesIO(blob)) as im:
                im.load()
                info = {'width': im.width, 'height': im.height, 'format': im.format.lower(),
                        'bytes': len(blob), 'sha256': digest, 'thought': thought}
            filename = name + '_' + str(len(record['images']) + 1) + '.' + info['format']
            (output / filename).write_bytes(blob)
            info['file'] = filename
            record['images'].append(info)

    try:
        request = urllib.request.Request(base + endpoint, method='POST',
            headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                     'X-Request-ID': record['client_correlation_id']},
            data=json.dumps(body, ensure_ascii=False).encode('utf-8'))
        try:
            response = urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            record['http_status'] = response.status
            record['request_id'] = response.headers.get('x-request-id') or response.headers.get('request-id')
            record['correlation_headers'] = {name: response.headers.get(name) for name in
                ('x-request-id', 'x-client-request-id', 'x-oneapi-request-id', 'x-upstream-request-id')
                if response.headers.get(name)}
            raw = response.read(100 * 1024 * 1024 + 1)
            record['content_type'] = response.headers.get('content-type')
        if len(raw) > 100 * 1024 * 1024:
            raise ValueError('Response exceeds 100 MiB')
        if 'text/event-stream' in (record['content_type'] or ''):
            for line in raw.splitlines():
                if line.startswith(b'data:') and line[5:].strip() != b'[DONE]':
                    collect(json.loads(line[5:]))
        else:
            collect(json.loads(raw))
        final_images = [item for item in record['images'] if not item['thought']]
        expected_present = bool(final_images)
        if record['expected_output'] == 'text':
            expected_present = record['metadata'].get('status') == 'completed'
        record['state'] = 'success' if record['http_status'] == 200 and expected_present else 'failed'
    except Exception as exc:
        record['state'] = 'failed'
        record['transport_or_decode_error'] = str(exc).replace(key, '[REDACTED]')[:800]
    record['elapsed_seconds'] = round(time.monotonic() - start, 2)
    target.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in record.items() if k != 'request'}, ensure_ascii=False), flush=True)
    return record


def main():
    available = cases()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cases', nargs='+', choices=available)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--timeout', type=int, default=360)
    parser.add_argument('--stream-responses', action='store_true', help='Use SSE for Responses cases to inspect terminal tool errors')
    args = parser.parse_args()
    if args.stream_responses:
        for name in args.cases:
            endpoint, body = available[name]
            if endpoint == '/v1/responses':
                body['stream'] = True
    if len(set(args.cases)) != len(args.cases):
        parser.error('Duplicate cases are forbidden')
    if not args.execute:
        print(json.dumps({name: available[name] for name in args.cases}, ensure_ascii=False, indent=2))
        return
    args.output.mkdir(parents=True, exist_ok=True)
    if any((args.output / (name + '.json')).exists() for name in args.cases):
        parser.error('Existing record blocks replay; choose an explicit new experiment directory')
    base, key = configuration()
    for name in args.cases:
        endpoint, body = available[name]
        run(name, endpoint, body, args.output, base, key, args.timeout)


if __name__ == '__main__':
    main()
