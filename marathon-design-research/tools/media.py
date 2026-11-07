"""Download explicitly catalogued research media and generate contact sheets.

Requires Pillow; downloads are public HTTP requests, never browser-session reads.
"""
import argparse, concurrent.futures, hashlib, io, json, math, time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, build_opener, ProxyHandler
from PIL import Image, ImageOps, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]

def write_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')

def derive():
    candidates=[]
    def add(source, items):
        unique=[]
        for m in items:
            url=m.get('url',m.get('src',''))
            if not url or url in unique: continue
            unique.append(url)
            candidates.append({'id':f'{source}-{len(unique):02d}','source':source,'url':url,'label':m.get('alt',''),'rights':'原作者保留权利；本地研究引用，非产品资产'})
    def page(s): return json.loads((ROOT/'outputs'/'pages'/s/'page.json').read_text('utf8'))
    brand=[m for m in page('S02')['media'] if m['tag']=='img' and m['attribute']=='src' and '.png' in m['url']]
    add('S02',brand[:15])
    add('S11',[m for m in page('S11')['links'] if 'original.fontsinuse.com' in m['url']])
    cinematic=[m for m in page('S14')['media'] if m['attribute']=='data-src']
    add('S14',cinematic[1::4][:15])
    add('S15',[m for m in page('S15')['media'] if m['attribute']=='src' and 'WestStudio-Marathon-' in m['url']][:12])
    add('S05',[m for m in page('S05')['media'] if m['attribute']=='src'][1:2])
    path=ROOT/'sources'/'assets.json'
    previous=json.loads(path.read_text('utf8')) if path.exists() else []
    merged={a['id']:a for a in previous}
    for candidate in candidates:merged.setdefault(candidate['id'],candidate)
    write_json(path,list(merged.values()))
    print('Candidate images:',len(candidates),'preserved catalog:',len(merged))

def download(asset,proxy=None):
    record=ROOT/'outputs'/'media'/(asset['id']+'.json')
    if record.exists():
        previous=json.loads(record.read_text('utf8'))
        if previous.get('url')==asset['url'] and previous.get('status')=='ok' and (ROOT/previous['preview']).exists(): return previous
    result=dict(asset)
    try:
        opener=build_opener(ProxyHandler({'https':proxy,'http':proxy} if proxy else {}))
        response=opener.open(Request(asset['url'],headers={'User-Agent':'Mozilla/5.0'}),timeout=25)
        raw=response.read(60_000_001)
        if len(raw)>60_000_000: raise ValueError('Image exceeds 60 MB limit')
        im=Image.open(io.BytesIO(raw)); size=im.size
        if min(size)<100: raise ValueError('Image is too small for reference')
        ext='.'+('jpg' if im.format=='JPEG' else im.format.lower())
        original=ROOT/'outputs'/'media'/(asset['id']+ext); original.parent.mkdir(parents=True,exist_ok=True); original.write_bytes(raw)
        preview=ROOT/'references'/'images'/(asset['id']+'.jpg'); preview.parent.mkdir(parents=True,exist_ok=True)
        image=im.convert('RGB'); image.thumbnail((1800,1400)); image.save(preview,quality=90)
        result.update(status='ok',size=list(size),sha256=hashlib.sha256(raw).hexdigest(),preview=preview.relative_to(ROOT).as_posix(),original=original.relative_to(ROOT).as_posix(),frames=getattr(im,'n_frames',1))
        if getattr(im,'n_frames',1)>1:
            duration=0
            for f in range(im.n_frames): im.seek(f); duration+=im.info.get('duration',0)
            result['duration_ms']=duration
    except Exception as error: result.update(status='error',error=str(error))
    write_json(record,result)
    return result

def contact(records):
    good=[r for r in records if r.get('status')=='ok']
    font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',18)
    out=ROOT/'outputs'/'contact-sheets'; out.mkdir(parents=True,exist_ok=True)
    for source in sorted(set(r['source'] for r in good)):
        rows=[r for r in good if r['source']==source]; w,h=400,270
        canvas=Image.new('RGB',(w*3,h*math.ceil(len(rows)/3)), '#e9e9e7'); draw=ImageDraw.Draw(canvas)
        for i,r in enumerate(rows):
            image=Image.open(ROOT/r['preview']); image.thumbnail((w-16,h-42)); x=(i%3)*w+(w-image.width)//2; y=(i//3)*h+5
            canvas.paste(image,(x,y)); draw.text(((i%3)*w+8,(i//3)*h+h-30),r['id']+'  '+str(r['size']),font=font,fill='#222222')
        canvas.save(out/(source+'.jpg'),quality=90)
    print('Contact sheets:',len(set(r['source'] for r in good)))

def main():
    p=argparse.ArgumentParser();p.add_argument('--derive',action='store_true');p.add_argument('--proxy');p.add_argument('--ids',nargs='*');args=p.parse_args()
    if args.derive: derive()
    assets=json.loads((ROOT/'sources'/'assets.json').read_text('utf8'))
    chosen=[a for a in assets if not args.ids or a['id'] in args.ids or a['source'] in args.ids]
    start=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records=list(pool.map(lambda a:download(a,args.proxy),chosen))
    for r in records: print(json.dumps({k:r[k] for k in ['id','status','size','error'] if k in r},ensure_ascii=False))
    all_records=[json.loads(p.read_text('utf8')) for p in (ROOT/'outputs'/'media').glob('*.json')]
    write_json(ROOT/'sources'/'media-index.json',all_records); contact(all_records)
    print('Elapsed seconds:',round(time.monotonic()-start,2))
if __name__=='__main__':main()
