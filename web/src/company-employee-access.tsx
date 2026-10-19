import { z } from 'zod';
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Employee={id:string;full_name:string;registration:string;status:string};
type Result={company_id:string;employees:Employee[];recovery_available:boolean};
const recoverySchema=z.object({company_id:z.string(),employee_id:z.string(),
  temporary_password:z.string().regex(/^[a-f0-9]{24}$/),expires_at:z.number().int().positive()});
type Recovery=z.infer<typeof recoverySchema>;

export function CompanyEmployeeAccess({companyId,csrf}:{companyId:string;csrf:string}) {
  const [data,setData]=useState<Result|null>(null);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Employee|null>(null);
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [recovery,setRecovery]=useState<Recovery|null>(null);
  const active=useRef(true);
  useEffect(()=>{
    active.current=true;
    const ctrl=new AbortController();
    fetch('/api/company/employees',{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
      .then(async response=>{
        if(!response.ok)throw new Error('Não foi possível consultar os acessos. Entre novamente ou tente mais tarde.');
        const payload=await response.json() as Result;
        if(payload.company_id!==companyId)throw new Error('A empresa da sessão mudou. Entre novamente.');
        if(active.current)setData(payload);
      }).catch(err=>{if(active.current&&!ctrl.signal.aborted)setError(err.message);});
    return ()=>{active.current=false;ctrl.abort();};
  },[companyId]);

  async function reset(event:FormEvent) {
    event.preventDefault();
    if(!selected||busy||!data?.recovery_available)return;
    const employeeId=selected.id;
    setBusy(true);setError('');setRecovery(null);
    try {
      const response=await fetch('/api/company/employees/'+encodeURIComponent(employeeId)+'/reset-password',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify({current_password:password})
      });
      const payload=await response.json().catch(()=>null);
      if(!response.ok) {
        const failure=z.object({error:z.object({message:z.string()})}).safeParse(payload);
        throw new Error(failure.success?failure.data.error.message:
          'A redefinição não foi confirmada. Confira o acesso antes de tentar novamente.');
      }
      const result=recoverySchema.safeParse(payload);
      if(!result.success||result.data.company_id!==companyId||result.data.employee_id!==employeeId)
        throw new Error('Resposta inesperada. A senha não pôde ser exibida com segurança.');
      if(active.current)setRecovery(result.data);
    }catch(err){if(active.current)setError(err instanceof Error?err.message:'Não foi possível confirmar a redefinição.');}
    finally {if(active.current){setBusy(false);setPassword('');}}
  }

  return <section className="company-schedules-card" aria-labelledby="employee-access-title">
    <h2 id="employee-access-title">Acesso dos funcionários</h2>
    <p>Se um funcionário esquecer a senha, confirme sua identidade antes de gerar uma senha provisória. A redefinição encerra as sessões desse funcionário nesta empresa.</p>
    {error&&<p role="alert" className="company-schedules-error">{error}</p>}
    {!data&&!error&&<p role="status">Consultando acessos…</p>}
    {data&&!data.recovery_available&&<p>A recuperação de acesso ainda não está disponível para esta empresa.</p>}
    {data?.recovery_available&&!selected&&<div className="company-schedules-list">
      {data.employees.filter(e=>e.status==='active').map(employee=><article key={employee.id} className="company-schedules-item">
        <strong>{employee.full_name}</strong>
        <p>Matrícula: {employee.registration}</p>
        <button type="button" className="company-schedules-secondary" onClick={()=>{
          setSelected(employee);setPassword('');setError('');setRecovery(null);
        }}>Redefinir acesso</button>
      </article>)}
      {!data.employees.some(e=>e.status==='active')&&<p>Nenhum funcionário ativo disponível.</p>}
    </div>}
    {selected&&<div style={{marginTop:16}}>
      <h3>Redefinir acesso de {selected.full_name}</h3>
      {!recovery?<form onSubmit={reset}>
        <p>A senha atual deixará de funcionar. Entregue a nova senha por um canal seguro e peça que o funcionário a altere ao entrar.</p>
        <label>Sua senha de administrador
          <input required type="password" value={password} maxLength={128}
            autoComplete="current-password" disabled={busy}
            onChange={event=>setPassword(event.target.value)}/>
        </label>
        <button disabled={busy||!password} type="submit">{busy?'Redefinindo…':'Confirmar redefinição'}</button>
      </form>:<div role="status" className="company-schedules-notice" style={{display:'block'}}>
        <p>Senha provisória — será exibida apenas nesta tela:</p>
        <code style={{display:'block',fontSize:18,overflowWrap:'anywhere',userSelect:'all'}}>{recovery.temporary_password}</code>
        <p>Validade: {new Date(recovery.expires_at).toLocaleString('pt-BR',{timeZone:'America/Bahia'})} (horário de Brasília).</p>
        <p>O funcionário precisará trocar a senha antes de acessar o ponto. Ao fechar esta tela, a senha não poderá ser consultada novamente.</p>
      </div>}
      <button type="button" className="company-schedules-secondary" disabled={busy}
        onClick={()=>{setSelected(null);setRecovery(null);setPassword('');setError('');}}>
        {recovery?'Fechar senha provisória':'Cancelar'}
      </button>
    </div>}
  </section>;
}
