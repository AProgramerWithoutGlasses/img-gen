"""Check the delivered research links, image evidence, token contrast and UI records."""
import argparse,copy,hashlib,json,re,sys
from pathlib import Path
from urllib.parse import unquote,urlsplit
from PIL import Image,ImageDraw,ImageStat
ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads((ROOT/path).read_text('utf8'))
def relative_target(file,target):
 if re.match(r'^[a-z][a-z0-9+.-]*:',target,re.I) or target.startswith('#'):return None
 return (file.parent/unquote(target.split('#')[0].split('?')[0])).resolve()
def case_errors(cases,catalog):
 errors=[];known={s['id'] for s in catalog}
 for case in cases:
  if not (ROOT/case['image']).is_file():errors.append(case['id']+': missing image '+case['image'])
  for source in case['sources']:
   if source not in known:errors.append(case['id']+': unknown source '+source)
 return errors
def luminance(color):
 rgb=[int(color[i:i+2],16)/255 for i in (1,3,5)]
 linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
 return sum(v*k for v,k in zip(linear,[.2126,.7152,.0722]))
def contrast(a,b):
 x,y=sorted([luminance(a),luminance(b)]);return (y+.05)/(x+.05)
def screenshot_color_matches(image,rect,expected):
 # Empty area inside the selected navigation tile, clear of glyphs and its border.
 x=rect['x']+180;y=rect['y']+200
 actual=ImageStat.Stat(image.convert('RGB').crop((x-4,y-4,x+5,y+5))).median
 target=[int(expected[i:i+2],16) for i in (1,3,5)]
 return max(abs(a-b) for a,b in zip(actual,target))<=18,actual
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--negative-probes',action='store_true');args=parser.parse_args()
 errors=[];cases=read('analysis/cases.json');catalog=read('sources/catalog.json');atlas=read('sources/atlas-data.json');tokens=read('system/tokens.json');errors+=case_errors(cases,catalog)
 for key in ['id']:
  values=[s[key] for s in catalog]
  if len(values)!=len(set(values)):errors.append('Duplicate source '+key)
 paths=set(g['preview'] for g in atlas['gallery'])|set(c['image'] for c in cases)|set(c['annotation'] for c in cases if c.get('annotation'))
 for m in atlas['motion']:
  if m['status']=='ok':paths.update([m['clip'],m['poster'],m['strip']])
 for path in paths:
  file=ROOT/path
  if not file.is_file():errors.append('Missing evidence '+path);continue
  if file.suffix.lower() in ['.jpg','.jpeg','.png','.gif','.webp']:
   try:
    with Image.open(file) as image:image.verify()
   except Exception as exc:errors.append(path+': '+str(exc))
 checked_links=0
 for file in ROOT.rglob('*.md'):
  if 'outputs' in file.relative_to(ROOT).parts:continue
  text=re.sub(r'```[\s\S]*?```','',file.read_text('utf8'))
  for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',text):
   resolved=relative_target(file,target.strip('<>'))
   if resolved is None:continue
   checked_links+=1
   if not resolved.exists():errors.append(str(file.relative_to(ROOT))+': broken link '+target)
 for file in [ROOT/'index.html',ROOT/'prototypes/index.html']:
  for target in re.findall(r'(?:src|href)="([^"]+)"',file.read_text('utf8')):
   resolved=relative_target(file,target)
   if resolved is None:continue
   checked_links+=1
   if not resolved.exists():errors.append(str(file.relative_to(ROOT))+': missing HTML asset '+target)
 ratios=[]
 for theme,t in tokens['themes'].items():
  pairs=[('ink','bg',4.5),('ink','surface',4.5),('ink','raised',4.5),('muted','bg',4.5),('muted','surface',4.5),('muted','raised',4.5),('accentText','bg',4.5),('onAccent','accent',4.5),('error','surface',4.5),('warning','surface',4.5),('control','surface',3),('control','raised',3)]
  for fg,bg,min_ratio in pairs:
   value=contrast(t[fg],t[bg]);ratios.append({'theme':theme,'foreground':fg,'background':bg,'ratio':round(value,2),'minimum':min_ratio,'pass':value>=min_ratio})
   if value<min_ratio:errors.append(f'Contrast {theme} {fg}/{bg}: {value:.2f} < {min_ratio}')
 checks=[]
 for path in ['outputs/browser-check/checks.json','outputs/browser-check/atlas-checks.json']:
  if (ROOT/path).exists():checks+=read(path)
 superseded={c.get('supersedes') for c in checks if c.get('pass') and c.get('supersedes')}
 latest={c['name']:c for c in checks};active=[c for name,c in latest.items() if name not in superseded]
 screenshot_colors=[]
 for check in active:
  if not check.get('pass'):errors.append('UI check failed: '+check['name'])
  if check.get('file') and check.get('rect'):
   image=Image.open(ROOT/'outputs/browser-check'/check['file']);r=check['rect']
   if r['x']<0 or r['y']<0 or r['x']+r['width']>image.width or r['y']+r['height']>image.height:errors.append('Screenshot misses intended viewport: '+check['name'])
   if check['name'].startswith('theme-direction-'):
    direction,theme=check['file'].removesuffix('.jpg').split('-');expected=tokens['themes'][theme]['accent' if direction=='signal' else 'raised'];ok,actual=screenshot_color_matches(image,r,expected)
    screenshot_colors.append({'file':check['file'],'expected':expected,'observed':actual,'pass':ok})
    if not ok:errors.append('Screenshot still shows a different theme or transition: '+check['file'])
 negatives={}
 if args.negative_probes:
  broken=copy.deepcopy(cases);broken[0]['image']='references/images/intentionally-missing-evidence.jpg';negatives['missing_image_rejected']=any('missing image' in e for e in case_errors(broken,catalog));negatives['same_color_contrast_rejected']=contrast('#ffffff','#ffffff')<4.5
  dark=next(c for c in active if c.get('file')=='studio-dark.jpg');fake=Image.open(ROOT/'outputs/browser-check'/dark['file']).convert('RGB');r=dark['rect'];x=r['x']+180;y=r['y']+200;ImageDraw.Draw(fake).rectangle((x-5,y-5,x+6,y+6),fill='#ffffff');negatives['stale_light_tile_in_dark_capture_rejected']=not screenshot_color_matches(fake,r,tokens['themes']['dark']['raised'])[0]
  if not all(negatives.values()):errors.append('Negative probe failed')
 inputs={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'prototypes/pilot.js',ROOT/'prototypes/pilot.css',ROOT/'atlas.js',ROOT/'atlas.css',ROOT/'system/tokens.json']}
 result={'date':'2026-11-07','local_links_checked':checked_links,'evidence_files_checked':len(paths),'contrast_pairs':ratios,'screenshot_colors':screenshot_colors,'active_browser_checks':len(active),'browser_passed':sum(bool(c.get('pass')) for c in active),'historical_failures_superseded':sorted(superseded),'negative_probes':negatives,'input_hashes':inputs,'errors':errors}
 (ROOT/'outputs/validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'links':checked_links,'evidence_files':len(paths),'contrast_pairs':len(ratios),'browser_checks':len(active),'negative_probes':negatives,'errors':errors},ensure_ascii=False))
 sys.exit(1 if errors else 0)
if __name__=='__main__':main()
