import { z } from 'zod';
export const COMPANY_LOGO_MAX_BYTES=24*1024;
export const COMPANY_LOGO_PATH=/^\/api\/platform\/companies\/[a-f0-9-]{36}\/logo\/[a-f0-9]{64}$/;
export function decodeCompanyLogo(value:string):{bytes:Uint8Array;type:string}|null {
  const match=/^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||value.length>COMPANY_LOGO_MAX_BYTES*4/3+40)return null;
  try{
    const raw=atob(match[2]);if(raw.length>COMPANY_LOGO_MAX_BYTES||btoa(raw)!==match[2])return null;
    const b=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(b.buffer);
    const ascii=(p:number,n:number)=>String.fromCharCode(...b.slice(p,p+n));
    const dimensions=(w:number,h:number)=>w>0&&h>0&&w<=512&&h<=512;
    if(match[1]==='png'){
      if(b.length<57||!b.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))return null;
      let p=8,count=0,hasData=false,ended=false;
      while(p+12<=b.length&&count++<128){
        const n=view.getUint32(p),type=ascii(p+4,4);if(n>b.length-p-12)return null;
        let crc=0xffffffff;
        for(let i=p+4;i<p+8+n;i++){crc^=b[i];for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
        if(((crc^0xffffffff)>>>0)!==view.getUint32(p+8+n))return null;
        if(count===1&&(type!=='IHDR'||n!==13||!dimensions(view.getUint32(p+8),view.getUint32(p+12))))return null;
        if(['acTL','fcTL','fdAT'].includes(type))return null;
        if(type==='IDAT')hasData=true;
        p+=12+n;
        if(type==='IEND'){ended=n===0;break;}
      }
      if(!ended||!hasData||p!==b.length)return null;
    }else{
      if(b.length<30||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WEBP'||view.getUint32(4,true)!==b.length-8)return null;
      let p=12,codec=false,count=0;
      while(p+8<=b.length&&count++<32){
        const type=ascii(p,4),n=view.getUint32(p+4,true),d=p+8;
        if(n>b.length-d||['ANIM','ANMF'].includes(type))return null;
        if(type==='VP8X'){
          if(n!==10||(b[d]&2)!==0||!dimensions(1+b[d+4]+(b[d+5]<<8)+(b[d+6]<<16),1+b[d+7]+(b[d+8]<<8)+(b[d+9]<<16)))return null;
        }else if(type==='VP8 '){
          if(codec||n<10||ascii(d+3,3)!=='\x9d\x01\x2a'||!dimensions(view.getUint16(d+6,true)&0x3fff,view.getUint16(d+8,true)&0x3fff))return null;codec=true;
        }else if(type==='VP8L'){
          if(codec||n<5||b[d]!==0x2f||(b[d+4]>>5)!==0||!dimensions(1+b[d+1]+((b[d+2]&63)<<8),1+(b[d+2]>>6)+(b[d+3]<<2)+((b[d+4]&15)<<10)))return null;codec=true;
        }
        p=d+n+(n%2);
      }
      if(!codec||p!==b.length)return null;
    }
    return {bytes:b,type:'image/'+match[1]};
  }catch{return null;}
}
export const companyLogoSchema=z.union([
  z.string().trim().url().max(2048).refine(v=>v.startsWith('https://')),
  z.string().max(COMPANY_LOGO_MAX_BYTES*4/3+40).refine(v=>decodeCompanyLogo(v)!==null),
  z.string().regex(COMPANY_LOGO_PATH),z.literal(''),z.null()
]).optional();
