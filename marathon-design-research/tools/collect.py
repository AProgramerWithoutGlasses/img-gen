"""Cache selected public research pages with traceable text, links, and media.

Run with Python 3.11+ and requests. No browser automation or authentication.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, re, time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
import requests

ROOT = Path(__file__).resolve().parents[1]

class Page(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url=url; self.text=[]; self.links=[]; self.media=[]; self.meta={}; self.styles=[]
        self.skip=0; self.title=False; self.title_text=[]; self.anchor=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='base' and a.get('href'): self.url=urljoin(self.url,a['href'])
        if tag in ('script','style','noscript'): self.skip+=1
        if tag=='title': self.title=True
        if tag=='a' and a.get('href'):
            self.anchor={'url':urljoin(self.url,a['href']),'text':''}; self.links.append(self.anchor)
        if tag in ('img','video','source','iframe'):
            for key in ('src','data-src','poster','srcset'):
                if a.get(key): self.media.append({'tag':tag,'attribute':key,'url':urljoin(self.url,a[key]) if key!='srcset' else a[key], 'alt':a.get('alt','')})
        if tag=='meta' and a.get('content'): self.meta[a.get('property',a.get('name',''))]=a['content']
        if tag=='link' and a.get('rel')=='stylesheet': self.styles.append(urljoin(self.url,a.get('href','')))
        if tag in ('p','h1','h2','h3','h4','li','br','div','section'): self.text.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript'): self.skip=max(0,self.skip-1)
        if tag=='title': self.title=False
        if tag=='a': self.anchor=None
        if tag in ('p','h1','h2','h3','h4','li','div','section'): self.text.append('\n')
    def handle_data(self,data):
        if self.title: self.title_text.append(data)
        if not self.skip:
            self.text.append(data)
            if self.anchor is not None: self.anchor['text']+=data

def collect(source, refresh=False, proxy=None):
    folder=ROOT/'outputs'/'pages'/source['id']; folder.mkdir(parents=True,exist_ok=True)
    index=folder/'page.json'
    if index.exists() and not refresh:
        old=json.loads(index.read_text('utf-8'))
        if old.get('url')==source['url'] and old.get('status')==200:
            return {'id':source['id'],'status':'cached','title':old.get('title')}
    result={'id':source['id'],'url':source['url'],'accessed':datetime.now(timezone.utc).isoformat()}
    try:
        session=requests.Session(); session.trust_env=False
        if proxy: session.proxies={'http':proxy,'https':proxy}
        response=session.get(source['url'],timeout=(12,35),headers={'User-Agent':'Mozilla/5.0 (compatible; local-design-research/1.0)'})
        result.update(status=response.status_code,final_url=response.url,content_type=response.headers.get('Content-Type',''))
        if response.status_code==200:
            html=response.content.decode('utf-8',errors='replace'); (folder/'source.html').write_text(html,encoding='utf-8')
            parsed=Page(response.url); parsed.feed(html)
            text='\n'.join(re.sub(r'\s+',' ',line).strip() for line in ''.join(parsed.text).splitlines())
            text=re.sub(r'\n{3,}','\n\n',text).strip()
            (folder/'text.txt').write_text(text,encoding='utf-8')
            result.update(title=''.join(parsed.title_text),sha256=hashlib.sha256(response.content).hexdigest(),text_chars=len(text),metadata=parsed.meta,links=parsed.links,media=parsed.media,styles=parsed.styles)
    except Exception as error: result.update(status='error',error=str(error))
    index.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return {k:result[k] for k in ('id','status','title','text_chars','error') if k in result}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--ids',nargs='*'); p.add_argument('--refresh',action='store_true'); p.add_argument('--proxy'); args=p.parse_args()
    sources=json.loads((ROOT/'sources'/'catalog.json').read_text('utf-8'))
    chosen=[s for s in sources if (not args.ids or s['id'] in args.ids) and s.get('fetch',True)]
    start=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(lambda s:collect(s,args.refresh,args.proxy),chosen): print(json.dumps(result,ensure_ascii=False),flush=True)
    print(json.dumps({'elapsed_seconds':round(time.monotonic()-start,2),'sources':len(chosen)}))
if __name__=='__main__': main()
