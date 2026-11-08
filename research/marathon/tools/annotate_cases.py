"""Add clearly identified research callouts without replacing source images."""
import json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
NOTES={
 'C02':[(.0,.0,.99,.084,'导航与主要入口形成独立的高对比区域。'),(.72,.09,.98,.74,'竖向标识构成品牌轴线，不占用影像中心。'),(.0,.75,.49,.99,'强色说明块聚合信息；颜色有明确的面积与职责。')],
 'C04':[(.02,.15,.24,.83,'左侧列表承担快速比较与选择。'),(.26,.13,.79,.86,'主体预览获得最大的连续画面。'),(.79,.39,.985,.86,'详情、属性与动作在固定区域承接。')],
 'C05':[(.025,.13,.32,.39,'展示标题与辅助文字形成字形和尺度反差。'),(.025,.42,.32,.91,'奖励清单与动作聚合，避免散落在预览四周。'),(.33,.13,.98,.91,'物品预览保留独立舞台，便于判断形态。')],
 'C07':[(.08,.12,.87,.79,'同一功能可比较多种轮廓与内部密度处理。'),(.08,.15,.19,.74,'先看整体轮廓，再考虑内部细节。')],
 'C08':[(.03,.10,.97,.82,'大模块和接缝解释结构，人物提供尺度线索。'),(.35,.15,.50,.67,'局部强调跟随部件位置，避免全表面均匀着色。')],
 'C12':[(.01,.01,.98,.98,'概念画面以网格与块层构成结构。'),(.36,.23,.83,.79,'编号与文字依附于区域；这是叙事屏幕研究。')],
 'C16':[(.38,.28,.82,.74,'显示区与实体控制区分工。'),(.69,.05,.98,.52,'重复旋钮、固定位置与有限色彩帮助建立操作映射。')],
 'C23':[(.0,.0,.333,.5,'先保留原操作上下文。'),(.667,.0,1,.5,'块阵作为转换过程，而非结果。'),(.667,.5,1,1,'最终落到稳定物品与操作区域。')]
}
def main():
 cases=json.loads((ROOT/'analysis/cases.json').read_text('utf8'));out=ROOT/'references/annotated';out.mkdir(parents=True,exist_ok=True)
 font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',22);small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18);number=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',24)
 for c in cases:
  if c['id'] not in NOTES:continue
  image=Image.open(ROOT/c['image']).convert('RGB');image.thumbnail((1200,790));w,h=image.size;notes=NOTES[c['id']];canvas=Image.new('RGB',(1200,h+100+54*len(notes)),'#eef0e8');canvas.paste(image,((1200-w)//2,0));draw=ImageDraw.Draw(canvas);left=(1200-w)//2
  for i,(x1,y1,x2,y2,label) in enumerate(notes,1):
   x1,y1,x2,y2=left+int(w*x1),int(h*y1),left+int(w*x2)-2,int(h*y2)-2
   draw.rectangle((x1,y1,x2,y2),outline='#c0fe04',width=4);draw.rectangle((x1,y1,x1+34,y1+34),fill='#c0fe04');draw.text((x1+9,y1+3),str(i),font=number,fill='#101600')
   y=h+78+(i-1)*54;draw.rectangle((24,y,56,y+32),fill='#1b211e');draw.text((32,y+1),str(i),font=number,fill='#c0fe04');draw.text((72,y+2),label,font=font,fill='#1b211e')
  draw.text((24,h+18),c['id']+' / 结构标注 · '+','.join(c['sources']),font=font,fill='#1b211e');draw.text((650,h+22),'框线和文字为本研究添加，原图另行保留。',font=small,fill='#53604f')
  path=out/(c['id']+'.jpg');canvas.save(path,quality=91);c['annotation']=path.relative_to(ROOT).as_posix()
 (ROOT/'analysis/cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf8');print('Annotated cases',len(NOTES))
if __name__=='__main__':main()
