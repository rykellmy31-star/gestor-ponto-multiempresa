import { useState,type FormEvent } from 'react';
import { Field } from './ui';
export function PlatformPasswordChange({csrf,onComplete}:{csrf:string;onComplete:()=>void}){
  const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e:FormEvent){e.preventDefault();setError('');
    if(password!==confirmation){setError('As novas senhas precisam ser iguais.');return;}
    if(password===current){setError('Escolha uma senha diferente da provisória.');return;}
    setBusy(true);try{
      const r=await fetch('/api/platform/auth/change-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({current_password:current,new_password:password})});
      const data=await r.json() as {error?:{message?:string}};if(!r.ok)throw new Error(data.error?.message??'Não foi possível alterar a senha.');
      setCurrent('');setPassword('');setConfirmation('');onComplete();
    }catch(e){setError(e instanceof Error?e.message:'Tente novamente.');}finally{setBusy(false);}}
  return <main className="platform-shell"><section className="platform-card"><h1>Troque sua senha provisória</h1>
    <p>Defina sua senha pessoal para liberar a administração. Use pelo menos 12 caracteres. Depois, entre novamente com a nova senha.</p>
    <form onSubmit={save}>
      <Field label="Senha provisória"><input type="password" required maxLength={128} autoComplete="current-password" disabled={busy} value={current} onChange={e=>setCurrent(e.target.value)}/></Field>
      <Field label="Nova senha"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></Field>
      <Field label="Confirme a nova senha"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></Field>
      {error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'Alterando…':'Alterar senha e entrar novamente'}</button>
    </form></section></main>;
}
