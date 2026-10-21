import { z } from 'zod';
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Employee={id:string;full_name:string;registration:string;status:string};
type Result={company_id:string;employees:Employee[];
  recovery_available:boolean;registration_available?:boolean};
type NewEmployee={full_name:string;registration:string;cpf:string;
  job_title:string;admission_date:string};
type CreatedEmployee={
  company_id:string;employee:Employee;
  temporary_password:string;expires_at:number;must_change_password:boolean;
};
const employeeCreateSchema=z.object({
  company_id:z.string(),
  employee:z.object({id:z.string(),full_name:z.string(),
    registration:z.string(),status:z.string()}),
  temporary_password:z.string().regex(/^[a-f0-9]{24}$/),
  expires_at:z.number().int().positive(),must_change_password:z.literal(true)
});
const emptyNewEmployee:NewEmployee={
  full_name:'',registration:'',cpf:'',job_title:'',admission_date:''
};
const recoverySchema=z.object({company_id:z.string(),employee_id:z.string(),
  temporary_password:z.string().regex(/^[a-f0-9]{24}$/),expires_at:z.number().int().positive()});
type Recovery=z.infer<typeof recoverySchema>;

export function CompanyEmployeeAccess({companyId,csrf,onEmployeeCreated}:{
  companyId:string;csrf:string;onEmployeeCreated?:()=>void
}) {
  const [data,setData]=useState<Result|null>(null);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Employee|null>(null);
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [recovery,setRecovery]=useState<Recovery|null>(null);
  const [newEmployee,setNewEmployee]=useState<NewEmployee>(emptyNewEmployee);
  const [creating,setCreating]=useState(false);
  const [created,setCreated]=useState<CreatedEmployee|null>(null);
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

  async function registerEmployee(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(creating||!data?.registration_available||created)return;
    setCreating(true);setError('');
    try {
      const response=await fetch('/api/company/employees',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify(newEmployee)
      });
      const payload=await response.json().catch(()=>null);
      if(!response.ok){
        const failure=z.object({error:z.object({message:z.string()})}).safeParse(payload);
        throw new Error(failure.success?failure.data.error.message:
          'Não foi possível confirmar o cadastro. Consulte a lista antes de tentar novamente.');
      }
      const parsed=employeeCreateSchema.safeParse(payload);
      if(!parsed.success||parsed.data.company_id!==companyId)
        throw new Error('Resposta não confirmada. Confira a lista antes de tentar novamente.');
      const result=parsed.data;
      if(active.current){
        setCreated(result);
        setData(prev=>prev?{...prev,employees:[...prev.employees,result.employee]}:prev);
        setNewEmployee(emptyNewEmployee);
        onEmployeeCreated?.();
      }
    }catch(err){
      if(active.current)setError(err instanceof Error?err.message:
        'Não foi possível confirmar o cadastro. Consulte a lista antes de tentar novamente.');
    }finally{if(active.current)setCreating(false);}
  }

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
    <p>Cadastre e acompanhe os acessos dos funcionários desta empresa. Senhas provisórias são exibidas uma única vez.</p>
    {data?.registration_available&&<div className="company-employee-registration">
      <h3>Cadastrar novo funcionário</h3>
      {!created?<form onSubmit={registerEmployee} className="company-employee-registration-form">
        <label>Nome completo
          <input required value={newEmployee.full_name} minLength={3} maxLength={140}
            autoComplete="name" disabled={creating}
            onChange={e=>setNewEmployee(v=>({...v,full_name:e.target.value}))}/>
        </label>
        <label>Matrícula nesta empresa
          <input required value={newEmployee.registration} maxLength={40}
            disabled={creating} placeholder="Ex.: JOAO-001"
            onChange={e=>setNewEmployee(v=>({...v,registration:e.target.value}))}/>
        </label>
        <label>CPF
          <input required value={newEmployee.cpf} maxLength={14} inputMode="numeric"
            disabled={creating} placeholder="000.000.000-00" autoComplete="off"
            onChange={e=>setNewEmployee(v=>({...v,cpf:e.target.value}))}/>
        </label>
        <label>Cargo
          <input value={newEmployee.job_title} maxLength={100} disabled={creating}
            onChange={e=>setNewEmployee(v=>({...v,job_title:e.target.value}))}/>
        </label>
        <label>Data de admissão
          <input type="date" required value={newEmployee.admission_date}
            disabled={creating} min="1900-01-01" max="2100-12-31"
            onChange={e=>setNewEmployee(v=>({...v,admission_date:e.target.value}))}/>
        </label>
        <p className="company-schedules-hint">
          O CPF é protegido no servidor. O funcionário receberá uma senha provisória
          para entrar com o CPF e deverá trocá-la no primeiro acesso.
          Atribua uma jornada a ele antes de liberar a marcação do ponto.
        </p>
        <button type="submit" disabled={creating}>
          {creating?'Cadastrando…':'Cadastrar funcionário'}
        </button>
      </form>:<div role="status" className="company-employee-initial-access">
        <strong>Cadastro confirmado: {created.employee.full_name}</strong>
        <p>Matrícula: {created.employee.registration}</p>
        <p>Senha inicial (exibida somente agora):</p>
        <code>{created.temporary_password}</code>
        <p>Válida até {new Date(created.expires_at).toLocaleString('pt-BR',{
          timeZone:'America/Bahia'
        })}. Entregue por canal seguro. O funcionário deverá criar uma nova senha.</p>
        <button type="button" className="company-schedules-secondary"
          onClick={()=>setCreated(null)}>Fechar senha e cadastrar outro</button>
      </div>}
    </div>}
    {data&&!data.registration_available&&<p className="company-schedules-hint">
      Cadastro direto de funcionários ainda não liberado neste ambiente.
    </p>}
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
