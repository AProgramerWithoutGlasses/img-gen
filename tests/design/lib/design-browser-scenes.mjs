// Captures the built production UI with deterministic, local-only example data.
// Metadata comes from the public preview seed; no production records are read.
export async function captureScenes({ page, fixture, setFixture, capture, origin }) {
  const base=structuredClone(fixture.snapshot);
  const stamp='2026-11-07T06:32:00.000Z';
  base.assets.forEach((a,i)=>{a.createdAt=i<8?stamp:'2026-11-06T06:32:00.000Z';a.options={...a.options,quality:undefined,resolution:undefined,ratio:'自动'}});
  base.generations.forEach(g=>{g.createdAt=stamp;g.options={modelId:g.options.modelId,ratio:'自动',count:g.options.count};g.cost=g.status==='failed'?0:g.imageIds.length});
  base.prices=Object.fromEntries(fixture.models.map(m=>[m.id,1]));
  base.priceUpdatedAt=Object.fromEntries(fixture.models.map(m=>[m.id,stamp]));
  base.preferences={theme:'light',enterToSend:true};
  await page.clock.setFixedTime(new Date('2026-11-07T08:00:00.000Z'));
  let sequence=0;
  async function open(route, options={}) {
    const data=structuredClone(base);
    if(options.user)data.currentUserId=options.user;
    if(options.empty){data.generations=data.generations.filter(g=>g.userId!==data.currentUserId);data.assets=data.assets.filter(a=>a.userId!==data.currentUserId)}
    if(options.history){
      const g=data.generations.find(g=>g.userId==='admin');
      data.generations=[
        {...g,id:'history-success',createdAt:stamp,cost:2},
        {...g,id:'history-partial',createdAt:'2026-11-07T06:20:00.000Z',status:'failed',options:{...g.options,modelId:'gemini-3.1-flash-image'},imageIds:[g.imageIds[0]],cost:1,error:'第 2 张生成失败'},
        {...g,id:'history-failed',createdAt:'2026-11-07T06:10:00.000Z',status:'failed',options:{...g.options,modelId:'gpt-image-1.5'},imageIds:[],cost:0,error:'生成失败'},
        {...g,id:'history-processing',createdAt:'2026-11-07T06:00:00.000Z',status:'processing',imageIds:[],cost:2},
      ];
    }
    if(options.processing){const g=data.generations.find(g=>g.userId==='admin');data.generations.push({...g,id:'processing-example',prompt:'参考上一轮图片，调整为柔和的暖色光线。',status:'processing',imageIds:[],createdAt:'2026-11-07T06:35:00.000Z',cost:2})}
    if(options.failed){const g=data.generations.find(g=>g.userId==='admin');data.generations=[{...g,status:'failed',imageIds:[],cost:0,error:'本次生成失败，未扣除积分。',attachments:Array.from({length:6},(_,i)=>({...data.assets[i],id:'attachment-example-'+i,name:`参考图 ${i+1}.svg`}))}]}
    if(options.newImages){const copy=data.assets.slice(0,2).map((a,i)=>({...a,id:'new-image-'+i,name:`新图片 ${i+1}.svg`,createdAt:'2026-11-07T07:50:00.000Z',batchId:'new-batch',outputIndex:i,folderIds:[]}));data.assets.unshift(...copy)}
    setFixture(data);
    await page.goto(origin+'/?designScene='+sequence+++'#'+route);
    await page.getByRole('button',{name:'我的账户',exact:true}).waitFor();
    if(options.dark){await page.evaluate(id=>localStorage.setItem('studio-preferences:'+id,JSON.stringify({theme:'dark',enterToSend:true})),data.currentUserId);await page.reload();await page.getByRole('button',{name:'我的账户',exact:true}).waitFor()}
    else await page.evaluate(()=>document.documentElement.dataset.theme='light');
  }
  const take=async(name,id)=>capture(name,id);
  await open('/create');
  await page.getByRole('button',{name:'添加',exact:true}).first().click();
  await page.getByRole('textbox',{name:'提示词',exact:true}).fill('保留主体形状，调整为暖灰背景，参考上一轮图片的光线。');
  await take('01-create-attachments',611);
  await page.getByRole('combobox',{name:'模型',exact:true}).selectOption('gemini-3.1-flash-image');
  await take('02-create-gemini-edit',1278);
  await take('03-create-result-added',2134);
  await page.getByRole('button',{name:'展开提示词',exact:true}).click();
  await take('04-create-expanded-prompt',1411);
  await open('/create',{empty:true});await take('05-create-empty',745);
  await open('/create');
  await page.getByRole('button',{name:'收起侧栏',exact:true}).click();
  await page.getByRole('button',{name:'我的账户',exact:true}).click();
  await page.getByRole('button',{name:'管理账户',exact:true}).click();
  await take('06-create-collapsed-account',1542);
  await open('/create',{processing:true});await take('07-create-processing',1676);
  await open('/create');
  await page.getByRole('combobox',{name:'模型',exact:true}).selectOption('gemini-3.1-flash-image');
  await page.getByRole('combobox',{name:'清晰度',exact:true}).selectOption('0.5K');
  await page.getByRole('combobox',{name:'图像比例',exact:true}).selectOption('21:9');
  await take('08-controls-gemini-current',1834);
  await open('/create',{failed:true});await page.getByRole('button',{name:'重新编辑',exact:true}).click();
  await take('09-create-failed-six-inputs',2023);
  await open('/gallery');await take('10-gallery-all',868);
  await open('/gallery',{newImages:true});await take('11-gallery-new-images-first',3964);
  await open('/gallery/pending');await take('12-gallery-empty-folder',2634);
  await open('/gallery',{user:'user1'});await take('13-gallery-empty',1050);
  await open('/gallery/inspiration');
  await page.getByRole('button',{name:'文件夹管理',exact:true}).click();
  await take('14-gallery-folder-menu',2368);
  await page.getByRole('menuitem',{name:'重命名',exact:true}).click();
  await take('15-gallery-rename-folder',3223);
  await open('/gallery');
  await page.getByRole('button',{name:'选择图片',exact:true}).click();
  await page.getByRole('checkbox',{name:/^选中 /}).nth(0).check();
  await page.getByRole('checkbox',{name:/^选中 /}).nth(2).check();
  await page.getByRole('toolbar',{name:'图片整理'}).getByRole('button',{name:'加入文件夹',exact:true}).click();
  await take('16-gallery-batch-organize',2501);
  await open('/gallery');await page.locator('.gallery-tile-image').first().click();await take('17-gallery-preview',1153);
  await open('/settings/account');await take('18-settings-account',2261);
  await page.getByRole('button',{name:'修改密码',exact:true}).click();
  await take('19-settings-password-dialog',4103);
  await open('/settings/account',{user:'user1'});await take('20-settings-ordinary-account',3887);
  await open('/settings/appearance');await take('21-settings-appearance',2878);
  await open('/settings/credits',{history:true});await take('22-settings-credit-history',2990);
  await open('/settings/users');await take('23-admin-users',3081);
  await page.getByRole('button',{name:'创建用户',exact:true}).click();await take('24-admin-create-user',3580);
  await open('/settings/requests');await take('25-admin-requests',3281);
  await page.locator('.request-prompt').first().click();await take('26-admin-request-detail',3722);
  await open('/settings/prices');await take('27-admin-prices',3446);
  await page.getByRole('spinbutton',{name:'GPT Image 2 单张积分',exact:true}).fill('3');
  await page.getByRole('button',{name:'刷新价格',exact:true}).click();await take('28-admin-unsaved-price',4160);
  const dark=[['/create','29-dark-create',{}],['/gallery','30-dark-gallery',{}],['/settings/account','31-dark-account',{}],['/settings/credits','32-dark-history',{history:true}],['/settings/appearance','33-dark-appearance',{}],['/settings/users','34-dark-users',{}],['/settings/requests','35-dark-requests',{}],['/settings/prices','36-dark-prices',{}]];
  for(const [route,name,options]of dark){await open(route,{...options,dark:true});await take(name,null)}
  await open('/create',{dark:true});await page.getByRole('button',{name:'我的账户',exact:true}).click();await page.getByRole('button',{name:'管理账户',exact:true}).click();await take('37-dark-account-menu',null);
}
