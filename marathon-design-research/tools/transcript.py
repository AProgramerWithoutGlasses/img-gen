"""Normalize existing WebVTT captions, preserving every distinct adjacent line."""
import argparse, html, json, re
from pathlib import Path
def seconds(t):
    v=t.replace(',','.').split(':'); return sum(float(n)*60**i for i,n in enumerate(reversed(v)))
def main():
    p=argparse.ArgumentParser();p.add_argument('vtt');args=p.parse_args();source=Path(args.vtt)
    text=source.read_text('utf8');segments=[];last=''
    for block in re.split(r'\n\s*\n',text):
        match=re.search(r'(\d\d:\d\d:\d\d[.,]\d+)\s*-->\s*(\d\d:\d\d:\d\d[.,]\d+)',block)
        if not match:continue
        lines=block[match.end():].splitlines()[1:]
        for line in lines:
            clean=html.unescape(re.sub(r'<[^>]+>','',line)).strip()
            if clean and clean!=last:
                segments.append({'start':seconds(match[1]),'end':seconds(match[2]),'text':clean});last=clean
    source.with_suffix('.json').write_text(json.dumps({'source':source.name,'kind':'platform captions; may contain automatic recognition errors','segments':segments},ensure_ascii=False,indent=2),encoding='utf8')
    source.with_suffix('.txt').write_text('\n'.join(f"[{s['start']:.2f}] {s['text']}" for s in segments),encoding='utf8')
    print(json.dumps({'segments':len(segments),'last_end':segments[-1]['end'] if segments else None,'text':source.with_suffix('.txt').name}))
if __name__=='__main__':main()
