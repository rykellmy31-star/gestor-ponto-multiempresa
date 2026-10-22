import { useEffect,useId,useRef,useState } from 'react';
import { COMPANY_LOGO_MAX_BYTES,decodeCompanyLogo } from '../../shared/company-logo';
export function CompanyLogoUpload({value,onChange,onBusy,disabled}:{value:string;onChange:(value:string)=>void;onBusy:(busy:boolean)=>void;disabled:boolean}){
  const id=useId(),active=useRef(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const uploaded=value.startsWith('data:')||value.startsWith('/api/platform/companies/');
  async function choose(file:File|undefined){
    if(!file)return;setError('');
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('Escolha PNG, JPG ou WebP de até 5 MB.');return;}
    setBusy(true);onBusy(true);let bitmap:ImageBitmap|undefined;
    try{
      bitmap=await createImageBitmap(file);
      if(bitmap.width*bitmap.height>40_000_000)throw new Error('A imagem é muito grande. Escolha uma versão menor.');
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw new Error('Não foi possível preparar a imagem.');
      for(const edge of [384,256,192,128,96]){
        const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const image=canvas.toDataURL('image/webp',0.85);
        if(image.length<=COMPANY_LOGO_MAX_BYTES*4/3+40&&decodeCompanyLogo(image)){
          if(active.current)onChange(image);return;
        }
      }
      throw new Error('Não foi possível otimizar essa imagem. Escolha outro arquivo.');
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'Não foi possível abrir a imagem.');}
    finally{bitmap?.close();if(active.current){setBusy(false);onBusy(false);}}
  }
  return <div style={{display:'grid',gap:8}}>
    <label htmlFor={id+'-file'}>Enviar logomarca do dispositivo (opcional)</label>
    <input id={id+'-file'} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||busy}
      onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void choose(file);}}/>
    <small>PNG, JPG ou WebP até 5 MB. A imagem será otimizada para a logomarca.</small>
    {busy&&<p role="status">Preparando imagem…</p>}
    {error&&<p role="alert">{error}</p>}
    {value&&<><img src={value} alt="Prévia da logomarca" style={{maxWidth:160,maxHeight:100,objectFit:'contain'}}/>
      <button type="button" disabled={disabled||busy} onClick={()=>{setError('');onChange('');}}>Remover logomarca</button></>}
    <label htmlFor={id+'-url'}>URL da logomarca (opcional)</label>
    <input id={id+'-url'} type="url" value={uploaded?'':value} disabled={disabled||busy} placeholder="https://exemplo.com/logo.png" pattern="https://.*"
      onChange={e=>{setError('');onChange(e.target.value);}}/>
  </div>;
}
