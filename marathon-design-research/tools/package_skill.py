"""Package authoritative system notes and original pilot examples into a portable skill."""
import hashlib,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'skill/marathon-ui-style';REF=OUT/'references';ASSET=OUT/'assets'
REF.mkdir(parents=True,exist_ok=True);ASSET.mkdir(exist_ok=True)
manifest=[]
for name in ['foundations.md','components.md','motion.md','tokens.json']:
 source=ROOT/'system'/name;target=REF/name
 if name.endswith('.md'):
  content=source.read_text('utf8').replace('../analysis/report.md','evidence.md').replace('../sources/motion-index.json','evidence.md')
  target.write_text(content,encoding='utf8')
 else:shutil.copy2(source,target)
 manifest.append({'source':source.relative_to(ROOT).as_posix(),'target':target.relative_to(OUT).as_posix(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
for name in ['studio-light.jpg','studio-dark.jpg','signal-light.jpg','signal-dark.jpg']:
 source=ROOT/'prototypes/screenshots'/name
 if not source.exists():raise FileNotFoundError(source)
 shutil.copy2(source,ASSET/name);manifest.append({'source':source.relative_to(ROOT).as_posix(),'target':'assets/'+name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
catalog=json.loads((ROOT/'sources/catalog.json').read_text('utf8'))
selected=['S01','S02','S11','S12','S13','S14','S15','S20','S24','S27','S32','S33','S38','S39','S41']
lines=['# 证据与采用边界','核对日期：2026-11-07。保留事实、观察和产品建议的区别。','',
 '原作的官网品牌、游戏交互、片中虚构屏幕和环境／CG 分别承担不同任务。商业字体身份以官网声明、字库说明和社区归档区分置信度；不能从名称相似推定完整授权或中文支持。',
 '片中故障画面用于叙事。工作室的输入、费用、错误和任务状态需要持续可读。游戏使用的图形、标识和研究截图不属于本包的产品资产。',
 '本包的 assets 是原创工作室试点，使用系统字体和自制 SVG 几何图。它们展示研究阶段的强度与结构，后续用户决定优先。','']
for s in catalog:
 if s['id'] in selected:lines.append(f"- **{s['id']}** [{s['title']}]({s['url']}) — {s['author']}；{', '.join(s['topics'])}。")
lines+=['','完整来源索引、案例与视频采样保存在原研究包 `marathon-design-research/`；本 skill 中的具体规则已包含足够的局部设计依据。']
(REF/'evidence.md').write_text('\n\n'.join(lines),encoding='utf8')
(ROOT/'outputs/skill-package.json').write_text(json.dumps({'status':'pilot draft','files':manifest},ensure_ascii=False,indent=2),encoding='utf8')
print('Packaged skill references and',sum(x['target'].startswith('assets/') for x in manifest),'original pilot examples')
