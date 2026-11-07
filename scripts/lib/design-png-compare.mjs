// Small PNG reader for the 8-bit RGB/RGBA images produced by Chromium and FigCraft.
// Uses only Node built-ins so design checks do not add application dependencies.
import { deflateSync, inflateSync } from 'node:zlib';

export function decodePNG(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Expected PNG');
  let width, height, channels;
  const chunks=[];
  for(let offset=8;offset<bytes.length;){
    const length=bytes.readUInt32BE(offset), type=bytes.toString('ascii',offset+4,offset+8), value=bytes.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){
      width=value.readUInt32BE(0);height=value.readUInt32BE(4);
      if(value[8]!==8 || ![2,6].includes(value[9]) || value[12]!==0)throw new Error('Requires non-interlaced 8-bit RGB/RGBA PNG');
      channels=value[9]===2?3:4;
    }
    if(type==='IDAT')chunks.push(value);
    offset+=length+12;
  }
  const packed=inflateSync(Buffer.concat(chunks)), stride=width*channels, raw=Buffer.alloc(height*stride), rgb=Buffer.alloc(width*height*3);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb && pa<=pc?a:pb<=pc?b:c};
  for(let y=0;y<height;y++){
    const filter=packed[y*(stride+1)];
    if(filter>4)throw new Error('Unsupported PNG row filter');
    for(let x=0;x<stride;x++){
      const i=y*stride+x,left=x>=channels?raw[i-channels]:0,up=y?raw[i-stride]:0,corner=y&&x>=channels?raw[i-stride-channels]:0;
      raw[i]=(packed[y*(stride+1)+x+1]+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner)))&255;
    }
  }
  for(let i=0,j=0;i<raw.length;i+=channels,j+=3){const alpha=channels===4?raw[i+3]/255:1;for(let c=0;c<3;c++)rgb[j+c]=Math.round(raw[i+c]*alpha+255*(1-alpha))}
  return {width,height,rgb};
}

export function comparePNG(a,b,region={x:0,y:0,w:a.width,h:a.height}){
  if(a.width!==b.width||a.height!==b.height)throw new Error(`Image size differs: ${a.width}×${a.height} / ${b.width}×${b.height}`);
  const x0=Math.max(0,Math.floor(region.x)),y0=Math.max(0,Math.floor(region.y)),x1=Math.min(a.width,Math.ceil(region.x+region.w)),y1=Math.min(a.height,Math.ceil(region.y+region.h));
  let count=0,total=0,bad=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=(y*a.width+x)*3,d=Math.max(Math.abs(a.rgb[i]-b.rgb[i]),Math.abs(a.rgb[i+1]-b.rgb[i+1]),Math.abs(a.rgb[i+2]-b.rgb[i+2]));
    count++;total+=d;if(d>40)bad++;
  }
  return {changedRatio:count?bad/count:0,meanDelta:count?total/count:0};
}

const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function chunk(type,value){
  const tag=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(value.length);
  let crc=0xffffffff;for(const byte of Buffer.concat([tag,value]))crc=crcTable[(crc^byte)&255]^(crc>>>8);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,tag,value,checksum]);
}
export function encodePNG({width,height,rgb}){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc(height*(width*3+1));
  for(let y=0;y<height;y++)rgb.copy(rows,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export function sideBySide(a,b){
  const width=a.width+b.width,height=Math.max(a.height,b.height),rgb=Buffer.alloc(width*height*3,255);
  for(const [image,offset]of [[a,0],[b,a.width]])for(let y=0;y<image.height;y++)image.rgb.copy(rgb,(y*width+offset)*3,y*image.width*3,(y+1)*image.width*3);
  return encodePNG({width,height,rgb});
}
