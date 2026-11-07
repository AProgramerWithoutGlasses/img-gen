// Read-only design comparison against the actual production frontend in Chromium.
// API metadata is a local, synthetic fixture; writes and external requests are blocked.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import { connect, call, data, documentPath, root } from './lib/figcraft.mjs';
import { captureScenes } from './lib/design-browser-scenes.mjs';
import { comparePNG, decodePNG, sideBySide } from './lib/design-png-compare.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function filesBelow(folder){
  const files=[];
  let entries;try{entries=await readdir(folder,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return files;throw error}
  for(const item of entries){
    const child=resolve(folder,item.name);
    if(item.isDirectory())files.push(...await filesBelow(child));else if(item.isFile())files.push(child);
  }
  return files.sort();
}
export async function frontendFingerprint(){
  const paths=[...await filesBelow(resolve(root,'frontend/src')),...await filesBelow(resolve(root,'frontend/public')),
    ...['index.html','vite.config.ts','tsconfig.json','package.json','package-lock.json','scripts/sync-server.mjs'].map(p=>resolve(root,'frontend',p))].sort();
  const values=[];for(const file of paths)values.push([file.slice(root.length).replaceAll('\\','/'),hash(await readFile(file))]);
  return hash(JSON.stringify(values));
}
export async function builtFingerprint(){
  const files=await filesBelow(resolve(root,'frontend/dist')),values=[];
  for(const file of files)values.push([file.slice(root.length).replaceAll('\\','/'),hash(await readFile(file))]);
  return hash(JSON.stringify(values));
}

async function main(){
  const manifest=JSON.parse(await readFile(resolve(root,'design/browser-reference/frames.json'),'utf8'));
  const sourceHash=await frontendFingerprint();
  let previous=manifest;
  try{previous=JSON.parse(await readFile(resolve(root,'.local/design-browser-build.json'),'utf8'))}catch{}
  let buildHash=await builtFingerprint().catch(()=>null);
  if(previous.frontendInputHash!==sourceHash || previous.builtHash!==buildHash){
    // Rebuild only when inputs/output changed; never modify or save the design.
    if(process.platform==='win32')execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm run build'],{cwd:root,stdio:'inherit',windowsHide:true});
    else execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit'});
    buildHash=await builtFingerprint();
    await mkdir(resolve(root,'.local'),{recursive:true});
    await writeFile(resolve(root,'.local/design-browser-build.json'),JSON.stringify({frontendInputHash:sourceHash,builtHash:buildHash}));
  }
  const fixture=JSON.parse(await readFile(resolve(root,'design/browser-reference/fixture.json'),'utf8'));
  const modelSource=await readFile(resolve(root,'frontend/src/config/models.ts'),'utf8');
  const compiled=ts.transpileModule(modelSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  fixture.models=(await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))).MODELS;
  const output=resolve(root,'outputs/design-browser-check',new Date().toISOString().replaceAll(':','-'));
  await mkdir(output,{recursive:true});
  const server=createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      const file=resolve(root,'frontend/dist','.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(resolve(root,'frontend/dist')+'/')&&!file.startsWith(resolve(root,'frontend/dist')+'\\'))throw new Error('Path outside frontend');
      const bytes=await readFile(file);
      res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});res.end(bytes);
    }catch{res.writeHead(404);res.end()}
  });
  await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser,client;
  const errors=[],results=[];
  try{
    client=await connect();
    const documents=data(await call(client,'run_command',{command:'doc.list'}));
    let document;
    for(const candidate of documents){
      const summary=data(await call(client,'inspect_document',{document:candidate.id,depth:0,fields:['name']}));
      if(resolve(summary.path||'')===resolve(documentPath)){
        if(summary.dirty)throw new Error('Save the target design before comparing; unsaved edits were preserved.');
        document=candidate.id;break;
      }
    }
    if(document===undefined)throw new Error('Open the configured design document first.');
    browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
    const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',timezoneId:'Asia/Shanghai'});
    let current=structuredClone(fixture.snapshot);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(['data:','blob:'].includes(url.protocol))return route.continue();
      if(url.origin!==origin){errors.push('External request blocked: '+url.origin);return route.abort()}
      if(url.pathname==='/api/studio/state'&&request.method()==='GET')return route.fulfill({json:current});
      if(url.pathname==='/api/studio/models'&&request.method()==='GET')return route.fulfill({json:fixture.models});
      if(url.pathname.startsWith('/api/')||request.method()!=='GET'){errors.push('Write or unexpected API blocked: '+url.pathname);return route.abort()}
      return route.continue();
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await captureScenes({page,fixture,origin,setFixture:value=>{current=value},capture:async(name)=>{
      const scene=manifest.frames.find(f=>f.name===name);if(!scene)throw new Error('Missing design frame for '+name);
      await page.mouse.move(1420,75);
      await page.evaluate(()=>document.fonts.ready);
      await page.evaluate(()=>Promise.all(Array.from(document.images).filter(im=>im.complete).map(im=>im.decode().catch(()=>{}))));
      if(await page.locator('.preview-badge').count())throw new Error('Expected the production UI, not preview mode');
      const browserFile=resolve(output,name+'-browser.png'),designFile=resolve(output,name+'-design.png');
      await page.screenshot({path:browserFile,animations:'disabled'});
      await call(client,'export',{document,ids:[scene.frameId],format:'png',path:designFile});
      const browserImage=decodePNG(await readFile(browserFile)),designImage=decodePNG(await readFile(designFile));
      const score=comparePNG(browserImage,designImage);
      let controls=null;
      if(await page.locator('.composer-toolbar:visible').count()){
        const rect=await page.locator('.composer-toolbar:visible').boundingBox();
        controls=comparePNG(browserImage,designImage,{x:rect.x,y:rect.y,w:rect.width,h:rect.height});
      }
      const passed=score.changedRatio<=.025&&score.meanDelta<=3&&(!controls||controls.changedRatio<=.06&&controls.meanDelta<=9);
      results.push({name,frameId:scene.frameId,status:passed?'passed':'failed',...score,controls});
      if(!passed||['01-create-attachments','22-settings-credit-history','37-dark-account-menu'].includes(name))await writeFile(resolve(output,name+'-comparison.png'),sideBySide(browserImage,designImage));
      console.log(`${passed?'PASS':'FAIL'} ${name}: ${(score.changedRatio*100).toFixed(2)}% changed pixels`);
    }});
    if(results.length!==manifest.frames.length)throw new Error('Some design frames were not compared');
    const failed=results.filter(r=>r.status==='failed');
    if(failed.length||errors.length)throw new Error(`${failed.length} visual mismatches; ${errors.length} browser errors`);
  }catch(error){errors.push(String(error));process.exitCode=1}
  finally{
    await browser?.close();await client?.close();await new Promise(yes=>server.close(yes));
    await writeFile(resolve(output,'result.json'),JSON.stringify({status:errors.length?'failed':'passed',frontendInputHash:sourceHash,builtHash:buildHash,results,errors},null,2));
    await writeFile(resolve(root,'outputs/design-browser-check/latest.json'),JSON.stringify({output,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,errors},null,2));
    console.log(`Browser/design comparison: ${results.filter(r=>r.status==='passed').length} passed, ${results.filter(r=>r.status==='failed').length} failed; evidence: ${output}`);
    if(errors.length)console.error(errors.join('\n'));
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
