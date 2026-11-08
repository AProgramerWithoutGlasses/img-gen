"""Build bounded research clips and timestamped strips from already saved media."""
import argparse,json,subprocess,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
CASES=[
 ('M01','S11','outputs/media/S11-04.gif',0,5,'阵营页：流动背景与稳定信息层'),
 ('M02','S11','outputs/media/S11-07.gif',0,5,'Codex：滚动文字带与静态正文'),
 ('M03','S11','outputs/media/S11-10.gif',0,5,'奖励页：选择与物品呈现'),
 ('M04','S21','outputs/video/S21/preview.mp4',0,4,'世界观短预览：图形层与图像切换'),
 ('M05','S23','outputs/video/S23/preview.mp4',0,4,'You Are Dead 短预览：身份与状态切换'),
 ('M06','S22','outputs/video/S22/preview.mp4',0,4,'2023 公告片短预览：材质与剪辑'),
 ('M07','S41','outputs/video/S41/banner.mp4',0,4,'界面作者公开背景循环'),
 ('M08','S14','outputs/video/S14/source.mp4',17,6,'CG：视线与图形标记'),
 ('M09','S14','outputs/video/S14/source.mp4',97,6,'CG：入口面板与状态光'),
 ('M10','S14','outputs/video/S14/source.mp4',246,6,'CG：空间中的信息终端'),
 ('M11','S14','outputs/video/S14/source.mp4',347,6,'CG：人物材质与近景运动'),
 ('M12','S14','outputs/video/S14/source.mp4',505,6,'CG：片尾排版的组织方式')
]
def main():
 p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);args=p.parse_args()
 out=ROOT/'references/motion';out.mkdir(parents=True,exist_ok=True);records=[];font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',16)
 for ident,source,file,start,duration,title in CASES:
  original=ROOT/file;clip=out/(ident+'.mp4');poster=out/(ident+'.jpg');strip=out/(ident+'-strip.jpg')
  if not original.exists():records.append({'id':ident,'source':source,'status':'missing','title':title});continue
  command=[args.ffmpeg,'-hide_banner','-loglevel','error']
  if original.suffix=='.gif':command+=['-ignore_loop','1']
  command+=['-ss',str(start),'-i',str(original),'-t',str(duration),'-an','-vf','scale=800:-2,fps=24','-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(clip)]
  if not clip.exists():subprocess.run(command,check=True)
  # Decode a small, deterministic contact sheet; labels refer to the saved clip timeline.
  frame_dir=ROOT/'outputs/motion-frames'/ident;frame_dir.mkdir(parents=True,exist_ok=True)
  subprocess.run([args.ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(clip),'-vf','fps=2,scale=400:-2',str(frame_dir/'%03d.jpg')],check=True)
  frames=sorted(frame_dir.glob('*.jpg'))
  if not frames:raise RuntimeError('No decoded frames for '+ident)
  choices=sorted(set(round(i*(len(frames)-1)/5) for i in range(6)))
  sheet=Image.new('RGB',(400*3,260*math.ceil(len(choices)/3)),'#e8e9e5');draw=ImageDraw.Draw(sheet)
  for i,k in enumerate(choices):
   image=Image.open(frames[k]);image.thumbnail((392,220));x=i%3*400;y=i//3*260;sheet.paste(image,(x+(400-image.width)//2,y+3));draw.text((x+8,y+233),f'{ident}  clip {k*.5:.1f}s',font=font,fill='black')
  sheet.save(strip,quality=88);Image.open(frames[0]).save(poster,quality=90)
  records.append({'id':ident,'source':source,'status':'ok','title':title,'source_media':file,'source_start_seconds':start,'requested_duration':duration,'decoded_sample_count':len(frames),'sample_step_seconds':.5,'clip':clip.relative_to(ROOT).as_posix(),'poster':poster.relative_to(ROOT).as_posix(),'strip':strip.relative_to(ROOT).as_posix(),'scope':'public short preview only' if source in ['S21','S22','S23','S41'] else 'bounded excerpt','timing_note':'条带时间为本地采样位置，非界面原生交互耗时；影片剪辑不直接决定产品动效参数'})
  print(ident,title,'samples',len(frames),flush=True)
 (ROOT/'sources/motion-index.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf8')
if __name__=='__main__':main()
