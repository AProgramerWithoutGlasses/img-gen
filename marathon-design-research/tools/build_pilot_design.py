"""Create editable SVG pilot boards BEFORE their browser implementation.

These are original study drawings, not Marathon assets or screenshots.
"""
import html,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'prototypes'/'design-source';OUT.mkdir(parents=True,exist_ok=True)
TOKENS={
 'light':{'bg':'#eeefea','surface':'#fafbf7','raised':'#ffffff','sidebar':'#e3e5de','ink':'#19201d','muted':'#536057','line':'#b8c0b5','control':'#75816f','accent':'#c0fe04','onAccent':'#111700','accentText':'#3e6500','blue':'#193bd4','error':'#af263c','warning':'#805000'},
 'dark':{'bg':'#171b1a','surface':'#202725','raised':'#2b3430','sidebar':'#111614','ink':'#f2f5ed','muted':'#acb9af','line':'#59695e','control':'#7f9186','accent':'#c0fe04','onAccent':'#111700','accentText':'#c0fe04','blue':'#a4b8ff','error':'#ff9eb0','warning':'#ffd289'},
}
DIRS={'field':{'title':'A · 理性工业','name':'FIELD','radius':8,'display':'Arial','headline':38,'strap':'A PLACE FOR EVERY IDEA'},'signal':{'title':'B · 强烈图形','name':'SIGNAL','radius':0,'display':'Arial','headline':48,'strap':'MAKE / UNMAKE / REMAKE'},'studio':{'title':'C · 混合表达','name':'STUDIO','radius':3,'display':'Georgia','headline':40,'strap':'Make room for the unseen.'}}
(ROOT/'system').mkdir(exist_ok=True)
(ROOT/'system'/'tokens.json').write_text(json.dumps({'status':'pilot proposal, not official Marathon tokens','version':1,'measured_reference':{'source':'S01','selector':'BUY NOW button','date':'2026-11-07','background':'#c0fe04'},'themes':TOKENS,'directions':DIRS,'spacing':[4,8,12,16,24,32,48,64],'motion':{'feedback':120,'state':180,'panel':240,'context':320,'ease':'cubic-bezier(0.2,0,0,1)','reduced':0}},ensure_ascii=False,indent=2),encoding='utf8')

class SVG:
 def __init__(self):self.parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">']
 def rect(self,x,y,w,h,fill,stroke=None,r=0):self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+'/>')
 def line(self,x1,y1,x2,y2,color,width=1):self.parts.append(f'<path d="M{x1} {y1} L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"/>')
 def path(self,d,fill,stroke=None):self.parts.append(f'<path d="{d}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+'/>')
 def circle(self,x,y,r,fill,stroke=None):self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+'/>')
 def text(self,x,y,text,size=14,color='#19201d',font='Microsoft YaHei UI',weight=400):self.parts.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="{font}" font-size="{size}" font-weight="{weight}">{html.escape(text)}</text>')
 def button(self,x,y,w,h,label,t,primary=False,r=3):
  self.rect(x,y,w,h,t['accent'] if primary else t['surface'],None if primary else t['control'],r);self.text(x+16,y+h/2+5,label,14,t['onAccent'] if primary else t['ink'],weight=600)
 def finish(self,path):path.write_text(''.join(self.parts)+'</svg>',encoding='utf8')

def artwork(s,x,y,w,h,second=False):
 # Original geometric color tests keep image pixels independent of UI themes.
 s.rect(x,y,w,h,'#dedfd7' if not second else '#e7dccc')
 if not second:
  s.path(f'M{x} {y+h} L{x+w*.64} {y+h*.43} L{x+w} {y+h*.7} L{x+w} {y+h} Z','#c7c9bd')
  s.circle(x+w*.69,y+h*.34,h*.23,'#ff563c')
  s.path(f'M{x+w*.19} {y+h*.28} L{x+w*.53} {y+h*.12} L{x+w*.74} {y+h*.39} L{x+w*.4} {y+h*.55} Z','#f8f9ee')
  s.path(f'M{x+w*.19} {y+h*.28} L{x+w*.4} {y+h*.55} L{x+w*.4} {y+h*.88} L{x+w*.19} {y+h*.61} Z','#202cb4')
  s.path(f'M{x+w*.4} {y+h*.55} L{x+w*.74} {y+h*.39} L{x+w*.74} {y+h*.72} L{x+w*.4} {y+h*.88} Z','#d7dbc9')
 else:
  s.rect(x+w*.14,y+h*.13,w*.31,h*.7,'#141d6e')
  s.circle(x+w*.61,y+h*.47,h*.33,'#ff653d')
  s.circle(x+w*.61,y+h*.47,h*.15,'#e7dccc')
  s.path(f'M{x+w*.42} {y+h*.78} L{x+w*.85} {y+h*.78} L{x+w*.96} {y+h*.9} L{x+w*.52} {y+h*.9} Z','#bdada1')
 s.text(x+16,y+h-16,'FORM STUDY / '+('02' if second else '01'),11,'#323d3c','Consolas')

def create(direction,theme,view='create'):
 t=TOKENS[theme];d=DIRS[direction];s=SVG();r=d['radius']
 s.rect(0,0,1440,900,t['bg']);s.rect(0,0,224,900,t['sidebar']);s.line(224,0,224,900,t['line'])
 s.rect(20,28,32,32,t['accent'],r=3);s.path('M27 48 L27 36 L45 36 L45 42 L34 42 L34 54 L27 54 Z',t['onAccent'])
 s.text(64,48,'UI STUDIO',20,t['ink'],'Arial',700);s.text(22,92,'PRIVATE IMAGE WORKSPACE',10,t['muted'],'Consolas')
 s.line(20,116,204,116,t['line']);s.text(22,150,'工作空间',12,t['muted'])
 nav_y=225 if view=='gallery' else 174
 s.rect(12,nav_y,200,46,t['accent'] if direction=='signal' else t['raised'],t['onAccent'] if direction=='signal' else t['control'],r)
 s.rect(12,nav_y,4,46,t['accent']);s.text(30,203,'01',12,t['onAccent'] if direction=='signal' else t['accentText'],'Consolas');s.text(64,203,'图像创作',15,t['onAccent'] if direction=='signal' else t['ink'],weight=600)
 s.text(30,254,'02',12,t['muted'],'Consolas');s.text(64,254,'我的图片',15,t['ink']);s.text(174,254,'24',12,t['muted'],'Consolas')
 s.line(20,286,204,286,t['line']);s.text(22,321,'我的文件夹',12,t['muted']);s.text(187,323,'+',20,t['ink'],'Consolas')
 for i,(label,count) in enumerate([('项目灵感','08'),('海报探索','12'),('材质实验','04')]):
  y=366+i*44;s.rect(27,y-13,13,10,'none',t['muted'],1);s.text(54,y,label,14,t['ink']);s.text(178,y,count,12,t['muted'],'Consolas')
 s.text(22,594,'COLLECT.',30,t['ink'],'Arial',700);s.text(22,628,'CREATE.',30,t['ink'],'Arial',700);s.text(22,662,'REPEAT.',30,t['ink'],'Arial',700)
 s.line(20,783,204,783,t['line']);s.circle(38,821,17,t['raised'],t['line']);s.text(32,827,'A',16,t['ink'],'Arial');s.text(65,818,'我的账户',14,t['ink']);s.text(65,840,'128 积分',12,t['muted']);s.text(188,827,'···',16,t['ink'],'Consolas')
 page_title='我的图片' if view=='gallery' else '图像创作'
 s.text(256,45,'工作室 / '+page_title,14,t['muted']);s.text(1196,45,'SESSION 004',12,t['muted'],'Consolas');s.line(224,78,1440,78,t['line'])
 if direction=='signal':s.rect(224,79,1216,116,t['accent'])
 heroink=t['onAccent'] if direction=='signal' else t['ink']
 s.text(256,119,'COLLECTION / 02' if view=='gallery' else 'CREATION / 01',11,heroink if direction=='signal' else t['accentText'],'Consolas');s.text(256,172,page_title,d['headline'],heroink,weight=700)
 s.text(776,160,d['strap'],27 if direction!='signal' else 22,heroink,d['display'],400 if direction=='studio' else 700)
 if direction=='signal':
  s.rect(256,188,1152,6,t['accent'])
  for i in range(12):s.rect(1350+i*4,110,2,19,t['accentText'])
 else:s.line(256,194,1408,194,t['line'])
 if view=='gallery':
  s.text(256,249,'全部图片',20,t['ink'],weight=600);s.text(360,249,'6 张示例',13,t['muted']);s.button(1294,218,114,40,'选择图片',t)
  for i in range(6):
   x=256+(i%3)*389.33;y=284+(i//3)*217;w=373.33;artwork(s,x,y,w,155,i%2==1);s.rect(x,y+155,w,46,t['surface'],t['line'],3);s.text(x+14,y+184,'FORM STUDY / '+str(i+1).zfill(2),14,t['ink'],'Consolas')
   if i<2:s.rect(x-3,y-3,w+6,207,'none',t['accentText'],3);s.rect(x+w-38,y+12,26,26,t['accent']);s.text(x+w-33,y+32,'✓',18,t['onAccent'],'Arial')
  s.rect(256,742,1152,76,t['surface'],t['control'],3);s.text(276,788,'已选择 2 张',16,t['ink']);s.button(1110,759,114,42,'取消选择',t);s.button(1236,759,152,42,'归入文件夹',t,True)
  s.finish(OUT/f'gallery-{theme}.svg');return
 s.rect(256,216,1152,72,t['surface'],t['line'],r)
 s.text(272,240,'01 / PROMPT',11,t['muted'],'Consolas');s.text(272,268,'用简单几何体探索蓝色、珊瑚橙与白色，保留清晰轮廓和自然留白。',16,t['ink'])
 for i,x in enumerate([256,840]):
  artwork(s,x,312,568,236,bool(i));s.rect(x,548,568,44,t['surface'],t['line'],r)
  s.text(x+16,576,'01' if not i else '02',12,t['muted'],'Consolas');s.text(x+406,576,'↓ 下载',13,t['ink']);s.text(x+488,576,'+ 添加',13,t['ink'])
 s.text(256,618,'GPT Image 2',12,t['muted']);s.text(1295,618,'2 / 2 完成',12,t['accentText'],'Consolas')
 for i,label in enumerate(['形态参考.svg','色彩参考.svg']):
  x=256+i*196;s.rect(x,642,184,34,t['surface'],t['line'],r);s.rect(x+7,649,20,20,'#1c36ba' if not i else '#fa653d');s.text(x+36,664,label,12,t['ink']);s.text(x+165,663,'×',14,t['muted'],'Arial')
 s.rect(256,688,1152,142,t['raised'],t['control'],r);s.text(276,722,'保留当前构图，让蓝色形体更轻盈，橙色圆环更有体积感。',16,t['ink']);s.text(276,752,'保持干净背景，强调材质之间的对比。',16,t['ink'])
 s.line(256,773,1408,773,t['line']);s.text(276,807,'+',24,t['ink'],'Consolas')
 s.button(316,784,176,34,'GPT Image 2   ▾',t,r=r);s.button(504,784,92,34,'2 张  ▾',t,r=r);s.button(608,784,110,34,'自动  ▾',t,r=r)
 s.text(1196,806,'2 积分',13,t['muted']);s.button(1282,782,110,38,'发送  ↗',t,True,r)
 s.text(256,860,'Enter 发送 · Shift + Enter 换行',11,t['muted']);s.text(1180,860,d['name']+' / '+theme.upper(),11,t['muted'],'Consolas')
 s.finish(OUT/f'{direction}-{theme}.svg')

def components(theme):
 t=TOKENS[theme];s=SVG();s.rect(0,0,1440,900,t['bg']);s.text(40,62,'COMPONENT STUDIES / C',13,t['accentText'],'Consolas');s.text(40,112,'组件、状态与反馈',36,t['ink'],weight=700);s.text(1060,104,'STUDIO / '+theme.upper(),16,t['muted'],'Consolas');s.line(40,144,1400,144,t['line'])
 for i,(label,primary) in enumerate([('默认',False),('悬浮',False),('按下',True),('键盘焦点',False)]):
  x=40+i*198;s.text(x,191,label,12,t['muted']);s.button(x,212,176,44,'新建文件夹',t,primary)
  if i==1:s.rect(x,212,176,44,t['raised'],t['accentText'],3);s.text(x+16,239,'新建文件夹',14,t['ink'],weight=600)
  if i==3:s.rect(x-4,208,184,52,'none',t['accentText'],5)
 s.text(40,308,'01 / INPUT',12,t['muted'],'Consolas');s.text(40,344,'文件夹名称',14,t['ink']);s.rect(40,362,360,48,t['surface'],t['accentText'],3);s.text(56,392,'海报探索',15,t['ink'])
 s.text(440,344,'名称已存在',14,t['error']);s.rect(440,362,360,48,t['surface'],t['error'],3);s.text(456,392,'项目灵感',15,t['ink']);s.text(440,437,'请使用其他名称。',12,t['error'])
 s.text(40,492,'02 / RANGE + SCROLL',12,t['muted'],'Consolas');s.text(40,526,'缩略图密度',14,t['ink']);s.text(342,526,'3 / 5',13,t['muted'],'Consolas');s.rect(40,554,360,4,t['line']);s.rect(40,554,180,4,t['accentText']);s.rect(209,544,22,24,t['accent'],t['ink'],2)
 for x in [40,130,220,310,400]:s.line(x,570,x,577,t['muted'])
 s.rect(440,482,360,114,t['surface'],t['line'],3);s.text(456,516,'目录 / 保留文字顺序',14,t['ink']);s.text(456,544,'滚动条提供位置与长度反馈。',13,t['muted']);s.rect(784,494,5,90,t['line'],r=2);s.rect(784,514,5,36,t['accentText'],r=2)
 s.text(40,642,'03 / SWITCH + STATUS',12,t['muted'],'Consolas');s.rect(40,672,48,26,t['accent'],r=13);s.circle(75,685,9,t['onAccent']);s.text(102,690,'Enter 发送',14,t['ink']);s.rect(252,674,20,20,t['accent'],r=2);s.text(256,690,'✓',14,t['onAccent'],'Arial');s.text(284,690,'已选择 2 张',14,t['ink'])
 s.rect(40,738,760,78,t['surface'],t['line'],3);s.rect(40,738,4,78,t['warning']);s.text(60,767,'部分完成：1 张成功，1 张失败',16,t['ink'],weight=600);s.text(60,795,'已保留成功结果。请查看失败原因后决定下一步。',13,t['muted'])
 s.rect(856,183,544,635,t['sidebar'],t['line'],6);s.text(880,214,'04 / DIALOG',12,t['muted'],'Consolas')
 s.rect(888,268,480,362,t['raised'],t['line'],3);s.rect(888,268,480,4,t['accent']);s.text(916,312,'新建文件夹',24,t['ink'],weight=700);s.text(1328,310,'×',20,t['muted'],'Arial')
 s.text(916,354,'为一组图片建立清晰的归属。',14,t['muted']);s.text(916,398,'文件夹名称',14,t['ink']);s.rect(916,416,424,48,t['surface'],t['control'],3);s.text(932,447,'材质探索',15,t['ink']);s.text(916,491,'1–60 个字符',12,t['muted'])
 s.line(888,540,1368,540,t['line']);s.button(1116,561,98,42,'取消',t);s.button(1226,561,114,42,'创建',t,True)
 s.text(880,691,'OPEN   240 ms',13,t['ink'],'Consolas');s.text(880,722,'遮罩先出现，面板移动 8 px 并淡入。',13,t['muted']);s.text(880,751,'焦点进入输入框，关闭后回到触发按钮。',13,t['muted']);s.text(880,780,'减少动态效果：取消位移，立即反馈。',13,t['muted'])
 s.text(40,862,'试点规范建议 · 数值与动效参数为本项目适配值',12,t['muted']);s.finish(OUT/f'components-{theme}.svg')

def mobile(theme):
 t=TOKENS[theme];s=SVG();s.parts[0]='<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">'
 s.rect(0,0,390,844,t['bg']);s.rect(0,0,390,90,t['sidebar']);s.rect(16,16,32,32,t['accent'],r=3);s.path('M23 36 L23 24 L41 24 L41 30 L30 30 L30 42 L23 42 Z',t['onAccent']);s.text(56,39,'UI STUDIO',17,t['ink'],'Arial',700)
 s.button(164,48,100,34,'图像创作',t,False);s.button(270,48,108,34,'我的图片',t,False);s.rect(164,48,3,34,t['accent']);s.line(0,90,390,90,t['line'])
 s.text(20,123,'工作室 / 图像创作',14,t['muted']);s.text(282,123,'SESSION 004',10,t['muted'],'Consolas');s.line(0,144,390,144,t['line'])
 s.text(20,179,'CREATION / 01',11,t['accentText'],'Consolas');s.text(20,224,'图像创作',30,t['ink'],weight=700);s.text(20,257,'Make room for the unseen.',17,t['ink'],'Georgia');s.line(20,268,370,268,t['line'])
 s.rect(20,290,350,97,t['surface'],t['line'],3);s.text(36,315,'01 / PROMPT',11,t['muted'],'Consolas');s.text(36,341,'用简单几何体探索蓝色、珊瑚橙与白色，',16,t['ink']);s.text(36,365,'保留清晰轮廓和自然留白。',16,t['ink'])
 for i,y in enumerate([411,616]):
  artwork(s,20,y,350,145,i==1);s.rect(20,y+145,350,44,t['surface'],t['line'],3);s.text(36,y+173,str(i+1).zfill(2),12,t['muted'],'Consolas');s.text(210,y+173,'↓ 下载',13,t['ink']);s.text(292,y+173,'+ 添加',13,t['ink'])
 s.text(20,838,'GPT Image 2',12,t['muted']);s.text(270,838,'2 / 2 完成',12,t['accentText'],'Consolas');s.finish(OUT/f'mobile-{theme}.svg')

for d in DIRS:
 for t in TOKENS:create(d,t)
for t in TOKENS:components(t)
for t in TOKENS:create('studio',t,'gallery')
for t in TOKENS:mobile(t)
print('Created 6 direction pilots + 2 component boards + 2 gallery + 2 narrow studies')
