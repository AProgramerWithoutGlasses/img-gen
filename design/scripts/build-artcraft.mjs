// Turn measured reference-page geometry into native editable FigCraft layers.
// Produces one batch; it does not modify the live document itself.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = resolve(root, 'design/assets/artcraft');
const steps = [];
const ref = name => ({ $ref: name });
const round = n => Math.round(n * 1000) / 1000;
function color(css) {
  if (!css || css === 'none' || css === 'transparent') return '#00000000';
  if (css.startsWith('#')) return css;
  const n = css.match(/[\d.]+/g).map(Number);
  return '#' + n.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    + (n.length > 3 ? Math.round(n[3] * 255).toString(16).padStart(2, '0') : '');
}
const transparent = css => color(css).endsWith('00') && color(css).length === 9;
const xml = text => text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const logo = (await readFile(resolve(assets, 'logo.png'))).toString('base64');
const gemini = await readFile(resolve(assets, 'model-google.svg'), 'utf8');

for (const width of [1920, 1440]) {
  const scene = JSON.parse(await readFile(resolve(assets, `reference-${width}.json`), 'utf8'));
  const { height } = scene;
  const key = `screen${width}`;
  steps.push({ command:'node.create', as:key, params:{type:'frame', name:`ArtCraft — Create Image — ${width}×${height}`, x:width===1920?0:2040,y:0,width,height,props:{fill:'#121316',clip:true}} });
  const composer = scene.items.find(i=>i.kind==='rect'&&i.rect.width>800&&i.rect.height===140).rect;
  const sections = {
    sidebar:{x:0,y:0,width:256,height,name:'01 · Sidebar'},
    header:{x:256,y:0,width:width-256,height:57,name:'02 · Header'},
    workspace:{x:256,y:57,width:width-256,height:height-57,name:'03 · Welcome'},
    composer:{...composer,name:'04 · Prompt composer'},
  };
  function section(item) {
    const r=item.rect;
    return r.x<256&&r.x+r.width<=256?'sidebar':r.y+r.height<=58?'header':r.y>=composer.y-2?'composer':'workspace';
  }
  function addRect(group, r, props, name) {
    const s=sections[group];
    steps.push({command:'node.create',params:{type:'rectangle',name,parent:ref(`${key}_${group}`),x:round(r.x-s.x),y:round(r.y-s.y),width:round(r.width),height:round(r.height),props}});
  }
  for (const [group, s] of Object.entries(sections)) {
    steps.push({command:'node.create',as:`${key}_${group}`,params:{type:'frame',name:s.name,parent:ref(key),x:s.x,y:s.y,width:s.width,height:s.height,props:{fill:'none',clip:false}}});
    // Panels and control surfaces follow their actual browser paint order.
    for (const item of scene.items.filter(i=>section(i)===group && ['rect','border'].includes(i.kind))) {
      const r=item.rect;
      if(item.kind==='rect') {
        if(transparent(item.color))continue;
        const props={fill:color(item.color),opacity:item.opacity,cornerRadius:Math.min(item.radius,r.width/2,r.height/2)};
        addRect(group,r,props,item.name==='section'?'Welcome panel':item.name==='header'?'Header surface':`Surface · ${item.name}`);
      } else {
        if(item.widths.every(w=>w===item.widths[0])&&item.colors.every(c=>c===item.colors[0])){
          if(!item.widths[0]||transparent(item.colors[0]))continue;
          addRect(group,r,{fill:'none',stroke:color(item.colors[0]),strokeWeight:item.widths[0],strokeAlign:'inside',cornerRadius:Math.min(item.radius,r.width/2,r.height/2),opacity:item.opacity},'Border');
        } else {
          const [t,rr,b,l]=item.widths;
          const boxes=[{x:r.x,y:r.y,width:r.width,height:t},{x:r.x+r.width-rr,y:r.y,width:rr,height:r.height},{x:r.x,y:r.y+r.height-b,width:r.width,height:b},{x:r.x,y:r.y,width:l,height:r.height}];
          for(let j=0;j<4;j++)if(item.widths[j]>0&&!transparent(item.colors[j]))addRect(group,boxes[j],{fill:color(item.colors[j]),opacity:item.opacity},'Divider');
        }
      }
    }
    // Import original vector icon geometry together, once per major region.
    const iconParts=[];
    for(const item of scene.items.filter(i=>section(i)===group&&['svg','image'].includes(i.kind))){
      const r=item.rect,x=round(r.x-s.x),y=round(r.y-s.y);
      if(item.kind==='image'&&item.src.endsWith('.png')){
        iconParts.push(`<image id="${xml(item.name)}" x="${x}" y="${y}" width="${r.width}" height="${r.height}" opacity="${item.opacity}" href="data:image/png;base64,${logo}"/>`);
      } else {
        let svg=item.kind==='svg'?item.svg:gemini.replaceAll('currentColor',color(item.color));
        svg=svg.replace(/font-family="[^"]*"/g,'font-family="Microsoft YaHei UI"');
        svg=svg.replace(/<svg\b[^>]*>/, match=>match.replace(/\s(width|height|x|y)="[^"]*"/g,'')+` `);
        // Set a viewport on the nested SVG so the original viewBox remains authoritative.
        const start=svg.indexOf('>');
        svg=svg.slice(0,start)+` x="${x}" y="${y}" width="${r.width}" height="${r.height}" opacity="${item.opacity}" id="${xml(item.name)}"`+svg.slice(start);
        iconParts.push(svg);
      }
    }
    if(group==='workspace'){
      const box=scene.items.find(i=>i.kind==='rect'&&i.name==='section').rect;
      for(const x of [box.x+1,box.x+box.width-1])for(const y of [box.y+1,box.y+box.height-1]){
        iconParts.push(`<path d="M${x-s.x-5} ${y-s.y}h11 M${x-s.x+.5} ${y-s.y-5.5}v11" stroke="#f2f1ee" stroke-opacity="0.4" stroke-width="1"/>`);
      }
    }
    if(group==='composer')iconParts.push(`<path d="M${s.width-29} 70l6 -6 M${s.width-27} 71l6 -6 M${s.width-25} 72l6 -6" stroke="#f2f1ee" stroke-opacity="0.6" stroke-width="0.65"/>`);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}" viewBox="0 0 ${s.width} ${s.height}" fill="none">${iconParts.join('\n')}</svg>`;
    const relative=`design/assets/artcraft/icons-${width}-${group}.svg`;
    await writeFile(resolve(root,relative),svg);
    const alias=`${key}_${group}_icons`;
    steps.push({command:'file.import',as:alias,params:{path:relative,x:0,y:0}});
    steps.push({command:'node.reparent',params:{ids:[ref(alias)],parent:ref(`${key}_${group}`)}});
    steps.push({command:'node.set',params:{ids:[ref(alias)],props:{name:'Original vector icons',x:0,y:0}}});
    for(const item of scene.items.filter(i=>section(i)===group&&i.kind==='text')){
      let text=item.text;
      if(item.transform==='uppercase')text=text.toUpperCase();
      if(item.transform==='lowercase')text=text.toLowerCase();
      const family=item.family.includes('Archivo')?'Archivo':item.family.includes('Geist Mono')?'Geist Mono':'Microsoft YaHei UI';
      const styles={100:'Thin',200:'ExtraLight',300:'Light',400:'Regular',500:'Medium',600:'SemiBold',700:'Bold',800:'ExtraBold',900:'Black'};
      const style=family==='Microsoft YaHei UI'?(item.weight>=600?'Bold':'Regular'):styles[Math.round(item.weight/100)*100];
      const variations=family==='Archivo'?{wght:item.weight,wdth:parseFloat(item.stretch)}:family==='Geist Mono'?{wght:item.weight}:undefined;
      const r=item.rect;
      steps.push({command:'node.create',params:{type:'text',name:text,parent:ref(`${key}_${group}`),text,x:round(r.x-s.x),y:round(r.y-s.y),props:{fill:color(item.color),opacity:item.opacity,fontFamily:family,fontStyle:style,fontSize:item.size,lineHeight:round(r.height),letterSpacing:item.letterSpacing,textAutoResize:'widthAndHeight',...(variations?{fontVariations:variations}:{}),...(text==='Reference'?{rotation:-6}:{})}}});
    }
  }
}
await writeFile(resolve(root,'design/commands/artcraft-wide.json'),JSON.stringify(steps,null,2));
console.log(JSON.stringify({screens:2,steps:steps.length,commands:'design/commands/artcraft-wide.json'}));
