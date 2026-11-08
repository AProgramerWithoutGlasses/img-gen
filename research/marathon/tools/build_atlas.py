"""Build a local, searchable atlas from the research catalog and case notes.

Dependency: Markdown (installed only under this research directory's outputs).
"""
import html,json,posixpath,re,sys
from pathlib import Path
from PIL import Image,ImageStat
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'outputs/python-deps'))
import markdown
def read(path):return json.loads((ROOT/path).read_text('utf8'))
def dump(path,value):
 p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
def render_doc(path):
 text=(ROOT/path).read_text('utf8');doc=markdown.markdown(text,extensions=['tables','fenced_code','toc'])
 def local(m):
  kind,target=m.group(1),m.group(2)
  if re.match(r'^[a-z]+:',target) or target.startswith('#'):return m[0]
  return f'{kind}="{posixpath.normpath(str(Path(path).parent).replace(chr(92),chr(47))+"/"+target)}"'
 doc=re.sub(r'(href|src)="([^"]+)"',local,doc)
 parts=re.split(r'(<[^>]+>)',doc)
 for i in range(0,len(parts),2):parts[i]=re.sub(r'\bS\d{2}\b',lambda m:f'<a class="source-ref" href="#source-{m[0]}">{m[0]}</a>',parts[i])
 return ''.join(parts)
def main():
 sources=read('sources/catalog.json');overrides=read('sources/status-overrides.json');cases=read('analysis/cases.json');media=read('sources/media-index.json');frames=read('sources/frame-index.json');motion=read('sources/motion-index.json');tokens=read('system/tokens.json')
 for s in sources:
  page=ROOT/'outputs/pages'/s['id']/'page.json';browser=ROOT/'outputs/browser'/(s['id']+'-page.json')
  d=json.loads(page.read_text('utf8')) if page.exists() else {}
  s['status']='reviewed' if d.get('status')==200 and d.get('text_chars',0)>300 else 'discovered'
  if d.get('status') and d.get('status')!=200:s['status']='unavailable'
  if browser.exists():s['status']='reviewed';s['capture']='rendered DOM'
  s.update(overrides.get(s['id'],{}))
  if s['id']=='S08':s.update(status='reviewed-video',note='原视频与英文平台字幕已保存；19 个时间点采样，转写覆盖到约 15:18。自动字幕可能误识别专名。',date='2024-11-24')
  if s['id']=='S14':s.update(note='导演页面与官方 8:44 视频；选取 12 个定位帧及 5 组短片分析，不宣称进行了逐镜全片统计。',video='https://www.youtube.com/watch?v=fvbEnWLRo1s')
  s['access_date']='2026-11-07'
 reviewed=[s for s in sources if s['status'].startswith('reviewed') or s['status']=='visual-reference']
 sources_by_id={s['id']:s for s in sources}
 gallery=[]
 for m in media:
  if m.get('status')!='ok':continue
  parent=sources_by_id[m['source']]
  gallery.append({'id':m['id'],'source':m['source'],'preview':m['preview'],'title':m.get('label') or parent['title']+' / '+m['id'].split('-')[-1],'kind':parent['kind'],'tags':parent['topics'],'url':parent['url'],'type':'image'})
 for f in frames:
  image=Image.open(ROOT/f['preview']).convert('L');stat=ImageStat.Stat(image)
  if stat.mean[0]<2 and stat.stddev[0]<2:continue
  parent=sources_by_id[f['source']];url='https://www.youtube.com/watch?v='+('JHApRRthYgQ' if f['source']=='S08' else 'fvbEnWLRo1s')+'&t='+str(int(f['time_seconds']))
  gallery.append({'id':f['id'],'source':f['source'],'preview':f['preview'],'title':parent['title']+' / '+f['label'],'kind':parent['kind'],'tags':parent['topics'],'url':url,'type':'frame','time':f['time_seconds']})
 gallery.append({'id':'S01-web','source':'S01','preview':'references/screenshots/S01-home.jpg','title':'当前官网：导航、主入口与影像区','kind':'official','tags':['品牌','网页','排版'],'url':sources_by_id['S01']['url'],'type':'screenshot'})
 payload={'sources':sources,'cases':cases,'gallery':gallery,'motion':motion,'tokens':tokens,'stats':{'sourceRecords':len(sources),'reviewedSources':len(reviewed),'cases':len(cases),'referenceImages':len(gallery),'motionStudies':sum(m['status']=='ok' for m in motion),'pilotFrames':12}}
 dump('sources/atlas-data.json',payload)
 index=['# 来源索引\n','核对日期：2026-11-07。记录条数包含受限与未深读项；状态分别标记。\n',f"- 来源记录：{len(sources)}\n- 已取得可读正文、视频材料或直接视觉证据：{len(reviewed)}\n- 深度案例：{len(cases)}\n"]
 for s in sources:
  index += [f"\n## {s['id']}\n",f"[{s['title']}]({s['url']})\n",f"作者／机构：{s.get('author','待核实')}；类别：{s['kind']}；状态：{s['status']}。\n",s.get('note','已保存可读取的来源资料；结论以研究报告标明的范围为准。')+'\n']
 (ROOT/'sources/INDEX.md').write_text('\n'.join(index),encoding='utf8')
 serialized=json.dumps(payload,ensure_ascii=False).replace('<','\\u003c')
 template=(ROOT/'tools/atlas-template.html').read_text('utf8')
 content=template.replace('@@DATA@@',serialized).replace('@@REPORT@@',render_doc('analysis/report.md')).replace('@@FOUNDATIONS@@',render_doc('system/foundations.md')).replace('@@MOTION@@',render_doc('system/motion.md')).replace('@@COMPONENTS@@',render_doc('system/components.md'))
 (ROOT/'index.html').write_text(content,encoding='utf8')
 print(json.dumps(payload['stats'],ensure_ascii=False))
if __name__=='__main__':main()
