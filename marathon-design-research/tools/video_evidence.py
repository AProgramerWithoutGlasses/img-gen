"""Extract timestamped source frames and short contact sheets with FFmpeg."""
import argparse, concurrent.futures, hashlib, json, math, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--video',required=True);p.add_argument('--times',nargs='+',type=float,required=True);p.add_argument('--ffmpeg',required=True);args=p.parse_args()
    video=Path(args.video).resolve(); digest=hashlib.sha256(video.read_bytes()).hexdigest()
    out=ROOT/'references'/'frames';out.mkdir(parents=True,exist_ok=True)
    def frame(t):
        ident=f'{args.source}-t{t:07.2f}'.replace('.','_');path=out/(ident+'.jpg')
        if not path.exists():
            subprocess.run([args.ffmpeg,'-hide_banner','-loglevel','error','-ss',str(t),'-i',str(video),'-frames:v','1','-vf','scale=1280:-2','-q:v','3',str(path)],check=True)
        if not path.exists():raise RuntimeError(f'No frame at {t}')
        return {'id':ident,'source':args.source,'time_seconds':t,'preview':path.relative_to(ROOT).as_posix(),'video':video.relative_to(ROOT).as_posix(),'source_sha256':digest,'kind':'video-frame','label':f'{int(t//60):02d}:{t%60:05.2f}'}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:records=list(pool.map(frame,args.times))
    index=ROOT/'sources'/'frame-index.json';old=json.loads(index.read_text('utf8')) if index.exists() else []
    combined={r['id']:r for r in old};combined.update({r['id']:r for r in records});index.write_text(json.dumps(list(combined.values()),ensure_ascii=False,indent=2),encoding='utf8')
    w,h=400,260;sheet=Image.new('RGB',(w*3,h*math.ceil(len(records)/3)),'#ecece9');draw=ImageDraw.Draw(sheet);font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',18)
    for i,r in enumerate(records):
        image=Image.open(ROOT/r['preview']);image.thumbnail((390,220));x=i%3*w;y=i//3*h;sheet.paste(image,(x+(w-image.width)//2,y+5));draw.text((x+10,y+230),args.source+'  '+r['label'],font=font,fill='black')
    dest=ROOT/'outputs'/'contact-sheets';dest.mkdir(parents=True,exist_ok=True);sheet.save(dest/(args.source+'-frames.jpg'),quality=90)
    print(json.dumps({'source':args.source,'frames':len(records),'hash':digest,'first':records[0]['time_seconds'],'last':records[-1]['time_seconds']}))
if __name__=='__main__':main()
