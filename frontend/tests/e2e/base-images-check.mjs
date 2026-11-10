// Local preview state and synthetic PNGs only: no production data or provider calls.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { prepareEvidenceOutput } from './evidence-output.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {url:output}=await prepareEvidenceOutput(process.argv.slice(2),{defaultDirectory:'frontend/outputs/base-images'});
let origin;
const server=await createServer({root,mode:'preview',server:{host:'127.0.0.1',port:0,strictPort:true}});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const errors=[],results=[];
let browser;
const names=Array.from({length:12},(_,i)=>`基础图候选-${i+1}.png`);

async function fixturePage(failed=false){
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await context.route('**/api/**',route=>{
    errors.push(`Unexpected API request blocked: ${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({status:503,json:{error:'本地专项禁止真实接口'}});
  });
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(origin);
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  await page.evaluate(async({png,failed})=>{
    const {createSeed}=await import('/src/preview/seed.ts');
    const {persistData}=await import('/src/preview/persistence.ts');
    const data=createSeed();
    data.currentUserId='admin';
    data.preferences={theme:'dark',enterToSend:false};
    data.assets.forEach((image,index)=>{image.name=`基础图候选-${index+1}.png`;image.url='data:image/png;base64,'+png;});
    if(failed){
      const batch=data.generations.find(item=>item.userId==='admin');
      batch.status='failed';
      batch.error='本地恢复草稿验证';
      batch.attachments=[{id:'restored-reference',name:'恢复的参考图.png',url:'data:image/png;base64,'+png,width:1,height:1}];
    }
    await persistData(data);
  },{png,failed});
  await page.reload();
  await expect(page.getByRole('button',{name:'我的账户',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  return {page,context};
}
async function gallery(page){
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'全部图片',exact:true}).click();
  await expect(page.locator('.gallery-tile')).toHaveCount(12);
}
const attachments=page=>page.locator('.attachment-item');
const bases=page=>page.locator('.attachment-item[data-base-image="true"]');
async function attachmentNames(page){return attachments(page).locator('img').evaluateAll(nodes=>nodes.map(image=>image.alt));}
async function baseNames(page){return bases(page).locator('img').evaluateAll(nodes=>nodes.map(image=>image.alt));}
async function editSingle(page,name){
  await gallery(page);
  const tile=page.locator('.gallery-tile').filter({has:page.getByRole('img',{name,exact:true})});
  await tile.hover();
  const edit=tile.getByRole('button',{name:'继续修图',exact:true});
  if(await edit.isVisible()) await edit.click();
  else{
    await tile.getByRole('button',{name:'更多图片操作',exact:true}).click();
    await page.getByRole('menuitem',{name:'继续修图',exact:true}).click();
  }
  await expect(page).toHaveURL(/#\/create$/);
}
async function removeAttachment(page,name){
  const item=attachments(page).filter({has:page.getByRole('img',{name,exact:true})});
  await item.hover();
  await item.getByRole('button',{name:'移除'+name,exact:true}).click();
}
async function upload(page,names){
  await page.getByLabel('上传图片文件',{exact:true}).setInputFiles(names.map(name=>({name,mimeType:'image/png',buffer:Buffer.from(png,'base64')})));
}
async function shot(page,name){
  await page.screenshot({path:fileURLToPath(new URL(name+'.png',output))});
  results.push(name);
}
async function pause(page){await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+20));}
async function toastDuration(page,total,{closable=true,action}={}){
  const toast=page.locator('.toast');
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button',{name:'关闭提示',exact:true})).toHaveCount(closable?1:0);
  if(action)await expect(toast.getByRole('button',{name:action,exact:true})).toBeVisible();
  await page.clock.fastForward(total-1);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1);
  await expect(toast).toHaveCount(0);
  await page.clock.resume();
}

try{
  await server.listen();
  origin=server.resolvedUrls.local[0].replace(/\/$/,'');
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  const {page,context}=await fixturePage();
  await page.clock.install();
  await upload(page,['参考图-A.png','参考图-B.png']);
  await expect(attachments(page)).toHaveCount(2);
  await pause(page);
  await editSingle(page,names[0]);
  await expect(bases(page)).toHaveCount(1);
  await toastDuration(page,2000,{closable:false});
  for(let i=1;i<4;i++){
    await editSingle(page,names[i]);
    await expect(bases(page)).toHaveCount(i+1);
  }
  await expect(page.locator('.dialog-base-image-badge')).toHaveCount(4);
  expect(await attachmentNames(page)).toEqual([...names.slice(0,4),'参考图-A.png','参考图-B.png']);
  await shot(page,'four-base-images-and-references');
  await editSingle(page,names[1]);
  await expect(attachments(page)).toHaveCount(6);
  expect(await baseNames(page)).toEqual(names.slice(0,4));
  await pause(page);
  await editSingle(page,names[4]);
  expect(await attachmentNames(page)).toEqual([...names.slice(0,4),'参考图-A.png','参考图-B.png']);
  await toastDuration(page,3000);
  await removeAttachment(page,names[0]);
  await expect(bases(page)).toHaveCount(3);
  await upload(page,['参考图-C.png']);
  await expect(attachments(page)).toHaveCount(6);
  await editSingle(page,names[4]);
  await expect(bases(page)).toHaveCount(3);
  expect(await attachmentNames(page)).toEqual([...names.slice(1,4),'参考图-A.png','参考图-B.png','参考图-C.png']);
  await removeAttachment(page,'参考图-C.png');
  await editSingle(page,names[4]);
  await expect(bases(page)).toHaveCount(4);
  await upload(page,['超额参考图.png']);
  const submitted=[...names.slice(1,5),'参考图-A.png','参考图-B.png'];
  expect(await attachmentNames(page)).toEqual(submitted);
  await page.getByRole('textbox',{name:'提示词',exact:true}).fill('四基础图与两参考图专项验证');
  await page.getByRole('button',{name:'生成',exact:true}).click();
  await expect(attachments(page)).toHaveCount(0,{timeout:15000});
  await expect(page.locator('.dialog-base-image-badge')).toHaveCount(0);
  const saved=await page.evaluate(async()=>{
    const {loadData}=await import('/src/preview/persistence.ts');
    const data=await loadData();
    return data.generations.find(job=>job.prompt==='四基础图与两参考图专项验证').attachments.map(image=>image.name);
  });
  expect(saved).toEqual(submitted);
  await shot(page,'generation-preserves-six-input-order-and-clears-base-state');
  await page.evaluate(()=>{location.hash='/gallery/inspiration';});
  await expect(page.locator('.gallery-tile')).toHaveCount(6);
  await page.locator('.gallery-tile').first().hover();
  await page.locator('.gallery-tile').first().getByRole('checkbox').check();
  await pause(page);
  await page.getByRole('toolbar',{name:'图片整理',exact:true}).getByRole('button',{name:'移出此文件夹',exact:true}).click();
  await toastDuration(page,6000,{action:'撤销'});
  await context.close();

  for(const count of [2,3,4,5]){
    const fixture=await fixturePage();
    await gallery(fixture.page);
    await fixture.page.getByRole('button',{name:'选择图片',exact:true}).click();
    const tiles=fixture.page.locator('.gallery-tile');
    for(let i=0;i<count;i++)await tiles.nth(i).getByRole('checkbox').check();
    const bar=fixture.page.getByRole('toolbar',{name:'图片整理',exact:true});
    const edit=bar.getByRole('button',{name:'继续修图',exact:true});
    if(count<=4){
      await expect(edit).toBeEnabled();
      await edit.click();
      await expect(fixture.page).toHaveURL(/#\/create$/);
      await expect(bases(fixture.page)).toHaveCount(count);
      expect(await baseNames(fixture.page)).toEqual(names.slice(0,count));
      await shot(fixture.page,'gallery-'+count+'-selected-continue-editing');
    }else{
      await expect(edit).toBeDisabled();
      const guard=bar.locator('.workbench-edit-guard');
      await expect(guard).toHaveAttribute('title',/4/);
      await expect(guard).toHaveAccessibleDescription(/4/);
      await shot(fixture.page,'gallery-over-four-disabled-with-reason');
    }
    await fixture.context.close();
  }
  const restored=await fixturePage(true);
  await editSingle(restored.page,names[0]);
  await expect(bases(restored.page)).toHaveCount(1);
  await restored.page.getByRole('button',{name:'查看错误',exact:true}).click();
  await restored.page.getByRole('dialog').getByRole('button',{name:'重新编辑',exact:true}).click();
  await expect(bases(restored.page)).toHaveCount(0);
  expect(await attachmentNames(restored.page)).toEqual(['恢复的参考图.png']);
  await shot(restored.page,'restore-draft-clears-base-classification');
  await restored.context.close();
  expect(errors).toEqual([]);
  await writeFile(new URL('verification.json',output),JSON.stringify({passed:results,errors,baseLimit:4,attachmentLimit:6,baseBeforeReferences:true,duplicateAndLimitPreserveItems:true,galleryTwoToFourEditing:true,galleryOverFourDisabled:true,toastMilliseconds:{baseSuccess:2000,ordinary:3000,undo:6000},generationAndRestoreClearBaseState:true},null,2));
  console.log(JSON.stringify({passed:results.length,errors:errors.length,baseLimit:4,attachmentLimit:6,galleryTwoToFourEditing:true,toastDurations:[2000,3000,6000]}));
}finally{
  await browser?.close();
  await server.close();
}
