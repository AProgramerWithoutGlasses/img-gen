"""Crop verified browser captures and assemble review sheets; never invent screenshots."""
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
def main():
 out=ROOT/'prototypes/screenshots';out.mkdir(parents=True,exist_ok=True)
 checks=json.loads((ROOT/'outputs/browser-check/checks.json').read_text('utf8'))
 for c in checks:
  if not c.get('file') or not c.get('rect'):continue
  a=c['rect'];image=Image.open(ROOT/'outputs/browser-check'/c['file'])
  if a['x']<0 or a['y']<0 or a['x']+a['width']>image.width or a['y']+a['height']>image.height:raise ValueError('Screenshot does not contain the intended frame: '+c['file'])
  image.crop((a['x'],a['y'],a['x']+a['width'],a['y']+a['height'])).save(out/c['file'],quality=93)
 font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',20)
 sheet=Image.new('RGB',(1440,760),'#e9ece4');draw=ImageDraw.Draw(sheet)
 for i,name in enumerate(['field-light','signal-light','studio-light','field-dark','signal-dark','studio-dark']):
  image=Image.open(out/(name+'.jpg'));image.thumbnail((464,290));x=i%3*480+8;y=i//3*380+48;sheet.paste(image,(x,y));draw.text((x,y-32),name,font=font,fill='#1b211e')
  labels={'field':'A / 理性工业','signal':'B / 强烈图形','studio':'C / 混合表达'};draw.text((x,y+298),labels[name.split('-')[0]],font=font,fill='#1b211e')
 sheet.save(out/'overview.jpg',quality=92)
 compare=Image.new('RGB',(1440,490),'#e9ece4');draw=ImageDraw.Draw(compare)
 for i,name in enumerate(['studio-light','studio-dark']):
  image=Image.open(out/(name+'.jpg'));image.thumbnail((704,440));compare.paste(image,(i*720+8,40));draw.text((i*720+12,8),'C / STUDIO · '+('浅色' if not i else '深色'),font=font,fill='#1b211e')
 compare.save(out/'studio-pair.jpg',quality=93);print('Prepared 6 browser frames, overview and theme pair')
if __name__=='__main__':main()
