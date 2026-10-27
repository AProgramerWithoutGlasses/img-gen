"""One explicit, non-retried Qiso dual-image edit probe. May incur API charges."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
from PIL import Image, ImageDraw
from probe_image_edits import encode_multipart

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'outputs' / 'two-image-edit-2026-10-27'
ROLE_PROMPT = '第一张图片是基础图（待修改的画面），第二张图片是参考图（仅提供替换对象或外观）。请根据用户指令修改基础图，保留未要求修改的构图、主体、背景和风格；不要把参考图当作基础画面，不要输出拼图。用户修改指令：'
PROMPT = '把基础图画面中间的橘色小猫换成参考图里的蓝色小猫，保留蓝猫的粉色耳朵、白色胸口和黄色星形项链。保持基础图左边红色花盆、右边绿色球、米色背景和棕色桌面不变。'


def fixtures():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, reference in [('base', False), ('reference', True)]:
        im = Image.new('RGB', (768, 768), '#eff5fa' if reference else '#f4e6cc')
        d = ImageDraw.Draw(im)
        if not reference:
            d.rectangle((0, 560, 768, 768), fill='#926944')
            d.polygon([(65, 450), (185, 450), (165, 570), (85, 570)], fill='#d44839')
            d.line((125, 450, 125, 290), fill='#46743c', width=14)
            d.ellipse((70, 310, 125, 370), fill='#568a47')
            d.ellipse((125, 280, 185, 340), fill='#568a47')
            d.ellipse((610, 500, 715, 605), fill='#5aab53', outline='#32672e', width=5)
        coat = '#388fcd' if reference else '#e7983c'
        d.arc((420, 385, 595, 575), 270, 100, fill=coat, width=42)
        d.ellipse((270, 360, 495, 610), fill=coat, outline='#253b48', width=5)
        d.polygon([(260, 285), (265, 135), (345, 215)], fill=coat, outline='#253b48', width=5)
        d.polygon([(420, 215), (500, 135), (505, 285)], fill=coat, outline='#253b48', width=5)
        d.polygon([(277, 235), (280, 165), (320, 215)], fill='#f6b5ca')
        d.polygon([(445, 215), (485, 165), (490, 235)], fill='#f6b5ca')
        d.ellipse((245, 210, 520, 415), fill=coat, outline='#253b48', width=5)
        d.ellipse((310, 275, 335, 310), fill='#162c36')
        d.ellipse((425, 275, 450, 310), fill='#162c36')
        d.polygon([(370, 325), (394, 325), (382, 340)], fill='#e68faa')
        d.line((382, 340, 382, 355), fill='#253b48', width=4)
        if reference:
            d.ellipse((330, 425, 435, 555), fill='white')
            d.line((290, 397, 382, 435, 475, 397), fill='#b6658b', width=9)
            d.regular_polygon((382, 442, 28), 5, rotation=0, fill='#ffda39')
        else:
            for y in (450, 490, 530):
                d.line((280, y, 320, y+10), fill='#a95b23', width=9)
        im.save(OUT / (name+'.png'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', choices=['gpt-image-2', 'gemini-3.1-flash-image'])
    args = parser.parse_args()
    config = dict(os.environ)
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                config.setdefault(key.strip(), value.strip().strip('\"\''))
    key = config.get('QISO_API_KEY')
    if not key:
        raise SystemExit('QISO_API_KEY is not configured')
    fixtures()
    target = OUT / (args.model+'.json')
    if target.exists():
        raise SystemExit('Evidence already exists; refusing to repeat a potentially billed request')
    paths = [OUT/'base.png', OUT/'reference.png']
    prompt = ROLE_PROMPT + PROMPT
    gemini = args.model.startswith('gemini-')
    if gemini:
        endpoint = '/v1beta/models/'+args.model+':generateContent'
        parts = [{'text':prompt}] + [{'inlineData':{'mimeType':'image/png','data':base64.b64encode(p.read_bytes()).decode()}} for p in paths]
        body = json.dumps({'contents':[{'role':'user','parts':parts}], 'generationConfig':{'responseModalities':['TEXT','IMAGE']}}).encode()
        content_type = 'application/json'
    else:
        endpoint = '/v1/images/edits'
        body, content_type = encode_multipart({'model':args.model,'prompt':prompt}, [('image[]',p) for p in paths])
    result = {'model':args.model,'endpoint':endpoint,'prompt':prompt,'inputs':[{'role':role,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for role,p in zip(['base','reference'], paths)]}
    target.write_text(json.dumps({**result,'state':'started'},ensure_ascii=False,indent=2),encoding='utf-8')
    started = time.monotonic()
    request = urllib.request.Request(config.get('QISO_BASE_URL','https://api.qiso.io').rstrip('/')+endpoint, data=body, headers={'Authorization':'Bearer '+key,'Content-Type':content_type})
    try:
        try:
            response = urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result['status'] = response.status
            result['request_id'] = response.headers.get('X-Request-Id',response.headers.get('Request-Id',''))
            payload = json.loads(response.read(72*1024*1024+1))
        encoded = []
        if gemini:
            result['returned_model'] = payload.get('modelVersion')
            for candidate in payload.get('candidates',[]):
                for part in candidate.get('content',{}).get('parts',[]):
                    inline = part.get('inlineData',part.get('inline_data',{}))
                    if inline.get('data') and not part.get('thought'):
                        encoded.append(inline['data'])
        else:
            result['returned_model'] = payload.get('model')
            encoded = [item['b64_json'] for item in payload.get('data',[]) if item.get('b64_json')]
        result['images'] = []
        for i,b64 in enumerate(encoded):
            data = base64.b64decode(b64)
            im = Image.open(io.BytesIO(data))
            output = OUT / (args.model+'-'+str(i)+'.'+im.format.lower())
            output.write_bytes(data)
            result['images'].append({'file':output.name,'width':im.width,'height':im.height,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        if not encoded:
            result['error'] = 'No image returned; full upstream response intentionally not retained'
    except Exception as error:
        result['error'] = type(error).__name__
    result['elapsed_seconds'] = round(time.monotonic()-started,2)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))


if __name__ == '__main__':
    main()
