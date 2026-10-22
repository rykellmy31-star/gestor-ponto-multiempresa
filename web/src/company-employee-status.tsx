import { useId, useState, type FormEvent } from 'react';
import { z } from 'zod';

type Employee={id:string;full_name:string;status:string;updated_at?:number;employment_end?:string|null};
const resultSchema=z.object({success:z.literal(true),company_id:z.string(),employee_id:z.string(),
  status:z.enum(['active','blocked','terminated']),employment_end:z.string().nullable(),updated_at:z.number().int()});

export function CompanyEmployeeStatus({employee,companyId,csrf,onUpdated,onSessionExpired}:{
  employee:Employee;companyId:string;csrf:string;
  onUpdated:(change:{status:string;employment_end:string|null;updated_at:number})=>void;
  onSessionExpired?:()=>void;
}) {
  const fieldId=useId();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [status,setStatus]=useState(employee.status==='active'?'blocked':'active');
  const [reason,setReason]=useState(''),[password,setPassword]=useState(''),[end,setEnd]=useState('');
  const [error,setError]=useState('');
  async function save(event:FormEvent){
    event.preventDefault();if(busy||uncertain)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/company/employees/'+encodeURIComponent(employee.id)+'/status',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify({status,expected_updated_at:employee.updated_at,reason,current_password:password,
          ...(status==='terminated'?{employment_end:end}:{})})
      });
      if(response.status===401){onSessionExpired?.();return;}
      const payload=await response.json().catch(()=>null),result=resultSchema.safeParse(payload);
      if(!response.ok){
        const failure=z.object({error:z.object({message:z.string()})}).safeParse(payload);
        throw new Error(failure.success?failure.data.error.message:'Atualize a lista antes de repetir a operação.');
      }
      if(!result.success||result.data.company_id!==companyId||result.data.employee_id!==employee.id||result.data.status!==status)
        throw new Error('Resposta não confirmada. Atualize a lista.');
      onUpdated(result.data);setOpen(false);setReason('');setEnd('');
    }catch(err){setError(err instanceof Error?err.message:'Atualize a lista para confirmar a situação.');setUncertain(true);}
    finally{setBusy(false);setPassword('');}
  }
  const label=employee.status==='active'?'Ativo':employee.status==='blocked'?'Bloqueado':'Desligado';
  return <div>
    <p>Situação: <strong>{label}</strong>{employee.employment_end?' · Desligamento: '+employee.employment_end.split('-').reverse().join('/'):''}</p>
    {employee.status!=='terminated'&&Number.isSafeInteger(employee.updated_at)&&!open&&<button type="button"
      className="company-schedules-secondary" onClick={()=>{setOpen(true);setStatus(employee.status==='active'?'blocked':'active');setError('');setUncertain(false);}}>
      Gerenciar vínculo
    </button>}
    {open&&<form onSubmit={save} className="company-employee-registration">
      <h3>Situação do vínculo</h3>
      <p>Bloqueio e desligamento encerram os acessos deste vínculo. A reativação exige novo login. Os pontos e jornadas anteriores são preservados.</p>
      <label htmlFor={fieldId+'-status'}>Nova situação</label>
      <select id={fieldId+'-status'} value={status} disabled={busy||uncertain} onChange={e=>setStatus(e.target.value)}>
        {employee.status==='blocked'&&<option value="active">Reativar acesso</option>}
        {employee.status==='active'&&<option value="blocked">Bloquear acesso</option>}
        <option value="terminated">Desligar funcionário</option>
      </select>
      {status==='terminated'&&<>
        <label>Data de desligamento<input type="date" required value={end} disabled={busy||uncertain} onChange={e=>setEnd(e.target.value)}/></label>
        <p>Conclua os dias de ponto abertos. A data não pode anteceder pontos já registrados. Este fluxo não reabre um desligamento.</p>
        <label className="company-schedules-check"><input type="checkbox" required disabled={busy||uncertain}/> Confirmo o desligamento deste vínculo.</label>
      </>}
      <label>Motivo da alteração<textarea required minLength={10} maxLength={500} value={reason} disabled={busy||uncertain} onChange={e=>setReason(e.target.value)}/></label>
      <label>Sua senha de administrador<input type="password" required maxLength={128} autoComplete="current-password" value={password}
        disabled={busy||uncertain} onChange={e=>setPassword(e.target.value)}/></label>
      {error&&<p role="alert">{error}</p>}
      <button type="submit" disabled={busy||uncertain}>{busy?'Confirmando…':'Confirmar alteração de vínculo'}</button>
      {uncertain&&<button type="button" onClick={()=>window.location.reload()}>Atualizar lista</button>}
      <button type="button" className="company-schedules-secondary" disabled={busy} onClick={()=>{setOpen(false);setPassword('');setReason('');}}>Cancelar alteração</button>
    </form>}
  </div>;
}
