import {useCallback,useEffect,useState,type FormEvent} from 'react';
import type {Schedule} from '../../server/types';
import {jsonRequest,isExpiredCompanySession} from './company-schedules-network';
type Day={date:string;assignment_id:string|null;schedule_id?:string;schedule_name?:string;shift:Schedule|null};
export function EmployeeAssignedSchedule({companyId,employeeId,csrf,timezone,onSessionExpired,onChanged,onEdit}:{
 companyId:string;employeeId:string;csrf:string;timezone:string;onSessionExpired?:()=>void;onChanged?:()=>void;
 onEdit?:(scheduleId:string)=>void;
}){
 const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [from,setFrom]=useState(localToday),[days,setDays]=useState<Day[]>([]),[open,setOpen]=useState(false);
 const [choices,setChoices]=useState<Array<{id:string;name:string}>>([]),[schedule,setSchedule]=useState('');
 const [effective,setEffective]=useState(localToday),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const r=await jsonRequest<{company_id:string;employee_id:string;days:Day[]}>('/company/schedules/employee/'+encodeURIComponent(employeeId)+'/week?from='+from,{signal});
   if(r.company_id!==companyId||r.employee_id!==employeeId)throw new Error('A sessão mudou.');
   if(!signal?.aborted){setDays(r.days);setError('');}}
  catch(e){if(signal?.aborted)return;if(isExpiredCompanySession(e))onSessionExpired?.();else setError(e instanceof Error?e.message:'Falha ao consultar escala.');}
 },[companyId,employeeId,from,onSessionExpired]);
 useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>c.abort();},[load]);
 async function edit(){setOpen(true);setError('');try{
  const r=await jsonRequest<{company_id:string;schedules:Array<{id:string;name:string}>}>('/company/schedules');
  if(r.company_id!==companyId)throw new Error('A sessão mudou.');setChoices(r.schedules);
 }catch(e){setError(e instanceof Error?e.message:'Falha ao consultar.');}}
 async function assign(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{const r=await jsonRequest<{company_id:string}>('/company/schedules/'+encodeURIComponent(schedule)+'/assign',{
   method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({employee_id:employeeId,effective_from:effective})});
   if(r.company_id!==companyId)throw new Error('A sessão mudou.');await load();setNotice('Escala atribuída. Histórico preservado.');onChanged?.();
  }catch(e){if(isExpiredCompanySession(e))onSessionExpired?.();else setError(e instanceof Error?e.message:'Confira antes de repetir.');}
  finally{setBusy(false);}}
 return <div className="company-employee-assigned-schedule">
  <p><strong>Escala em {from.split('-').reverse().join('/')}:</strong> {days[0]?.schedule_name||'Nenhuma escala atribuída'}</p>
  {days[0]?.shift&&<p>Horário: {days[0].shift.start}–{days[0].shift.end} · Intervalo: {days[0].shift.break_start}–{days[0].shift.break_end}</p>}
  <button type="button" className="company-schedules-secondary" onClick={()=>void edit()}>Ver e alterar escala</button>
  {open&&<div><label>Consultar a partir de<input type="date" min="1900-01-01" max="2100-12-24" value={from} onChange={e=>{if(e.target.value)setFrom(e.target.value);}}/></label>
   <ul>{days.map(d=><li key={d.date}>{d.date.split('-').reverse().join('/')} · {d.schedule_name||'Sem escala'} · {d.shift?d.shift.start+'–'+d.shift.end:'Folga ou sem expediente'}</li>)}</ul>
   {days[0]?.schedule_id&&onEdit&&choices.some(s=>s.id===days[0]?.schedule_id)&&<button type="button" onClick={()=>onEdit(days[0].schedule_id!)}>Editar horários em nova versão</button>}
   <form onSubmit={assign}><fieldset disabled={busy}><legend>Alterar escala deste funcionário</legend>
    <label>Nova escala<select aria-label="Nova escala" required value={schedule} onChange={e=>setSchedule(e.target.value)}><option value="">Selecione</option>{choices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Válida a partir de<input required type="date" value={effective} onChange={e=>setEffective(e.target.value)}/></label>
    <p>Se já houver outra atribuição na mesma data, escolha a próxima data de mudança. Dias com ponto confirmado conservam o horário registrado.</p>
    <button>Salvar escala do funcionário</button></fieldset></form>
   <button type="button" disabled={busy} onClick={()=>setOpen(false)}>Fechar escala</button></div>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </div>;
}
