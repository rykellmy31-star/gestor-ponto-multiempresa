import { deflateSync } from 'node:zlib';
function chunk(type:string,data:Buffer){
  const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);
  let crc=0xffffffff;for(const v of body){crc^=v;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
export function png(width=1,animated=false){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(animated?[chunk('acTL',Buffer.alloc(8))]:[]),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
  return 'data:image/png;base64,'+bytes.toString('base64');
}
export const logoFixture=png();
