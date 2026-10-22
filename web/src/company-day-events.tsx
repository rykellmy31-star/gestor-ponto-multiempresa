import { useEffect,useRef,useState,type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { Field } from './ui';
import { jsonRequest,isExpiredCompanySession } from './company-schedules-network';
import type { CompanyDayEvent } from '../../shared/company-day-events';
type Loaded={company_id:string;employee_id:string;month:string;timezone:string;events:CompanyDayEvent[]};
export function CompanyDayEvents({companyId,employees,csrf,onSessionExpired}:{companyId:string;
  employees:Array<{id:string;full_name:string}>;csrf:string;onSessionExpired:()=>void}) {
  const [employee,setEmployee]=useState(''),[month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [loaded,setLoaded]=useState<Loaded|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [date,setDate]=useState(''),[kind,setKind]=useState('holiday'),[reason,setReason]=useState('');
  const [name,setName]=useState(''),[occurrence,setOccurrence]=useState('day_off'),[paid,setPaid]=useState(false);
  const [times,setTimes]=useState(['','','','']);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  function clear(){pending.current?.abort();setLoaded(null);setError('');setBusy(false);}
  async function read(){
    const controller=new AbortController();pending.current?.abort();pending.current=controller;
    const data=await jsonRequest<Loaded>('/company/day-events?'+new URLSearchParams({employee_id:employee,month}),{signal:controller.signal});
    if(controller.signal.aborted)return;
    if(data.company_id!==companyId||data.employee_id!==employee||data.month!==month||!Array.isArray(data.events))throw new Error('Dados não confirmados para a empresa.');
    setLoaded(data);
  }
  async function consult(event:FormEvent){
    event.preventDefault();clear();setBusy(true);
    try{await read();}catch(err){if(isExpiredCompanySession(err))onSessionExpired();else setError(err instanceof Error?err.message:'Não foi possível consultar.');}
    finally{setBusy(false);}
  }
  const current=loaded?.events.find(e=>e.work_date===date&&e.kind===kind);
  async function save(event:FormEvent,cancel=false){
    event.preventDefault();if(!loaded||busy||date.slice(0,7)!==month)return;
    setBusy(true);setError('');
    try{
      const marks=times.map(t=>DateTime.fromISO(t,{zone:loaded.timezone}).toMillis());
      if(kind==='adjustment'&&!cancel&&!marks.every(Number.isSafeInteger))throw new Error('Preencha os quatro horários do ajuste.');
      const value=cancel?null:kind==='holiday'?{name}:kind==='occurrence'?{kind:occurrence,paid}:{marks};
      const result=await jsonRequest<{success:boolean;company_id:string}>('/company/day-events',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify({work_date:date,kind,reason,value,expected_revision:current?.revision??0,
          ...(kind==='holiday'?{}:{employee_id:employee})})
      });
      if(!result.success||result.company_id!==companyId)throw new Error('Resposta não confirmada. Consulte os tratamentos novamente.');
      await read();setReason('');
    }catch(err){setLoaded(null);if(isExpiredCompanySession(err))onSessionExpired();else setError(err instanceof Error?err.message:'Consulte os tratamentos antes de tentar novamente.');}
    finally{setBusy(false);}
  }
  return <section className="company-schedules-card">
    <h2>Calendário e tratamentos do ponto</h2>
    <p>Feriados valem para toda esta empresa. Ocorrências e ajustes valem somente para o funcionário selecionado. Consulte novamente a apuração depois de salvar.</p>
    <form onSubmit={consult} className="company-schedules-assign">
      <Field label="Funcionário dos tratamentos"><select required value={employee} disabled={busy} onChange={e=>{clear();setEmployee(e.target.value);}}>
        <option value="">Selecione</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
      </select></Field>
      <Field label="Mês dos tratamentos"><input type="month" required value={month} disabled={busy} onChange={e=>{clear();setMonth(e.target.value);setDate('');}}/></Field>
      <button disabled={busy}>Consultar tratamentos</button>
    </form>
    {error&&<p role="alert" className="company-schedules-error">{error}</p>}
    {loaded&&<>
      <form onSubmit={save} className="company-employee-registration">
        <Field label="Data do tratamento"><input type="date" required value={date} min={month+'-01'}
          max={DateTime.fromISO(month+'-01').endOf('month').toISODate()??''} disabled={busy} onChange={e=>setDate(e.target.value)}/></Field>
        <Field label="Tipo de tratamento"><select value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}>
          <option value="holiday">Feriado da empresa</option><option value="occurrence">Ocorrência aprovada</option><option value="adjustment">Ajuste de horários</option>
        </select></Field>
        {kind==='holiday'&&<Field label="Nome do feriado"><input value={name} minLength={2} maxLength={120} required onChange={e=>setName(e.target.value)}/></Field>}
        {kind==='occurrence'&&<>
          <Field label="Ocorrência"><select value={occurrence} onChange={e=>setOccurrence(e.target.value)}>
            <option value="day_off">Folga autorizada</option><option value="medical">Atestado</option><option value="justified_absence">Ausência justificada</option>
          </select></Field>
          <label className="company-schedules-check"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/> Abonar horas previstas não trabalhadas</label>
        </>}
        {kind==='adjustment'&&<>
          <p>Informe os quatro horários no fuso {loaded.timezone}. O dia precisa ter marcação original. Ajustes não substituem comprovantes e não fecham um turno original incompleto.</p>
          {['Entrada ajustada','Início do intervalo ajustado','Retorno ajustado','Saída ajustada'].map((label,i)=><Field key={label} label={label}>
            <input type="datetime-local" required value={times[i]} onChange={e=>setTimes(v=>v.map((t,j)=>i===j?e.target.value:t))}/>
          </Field>)}
        </>}
        <Field label="Justificativa do tratamento"><textarea required minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
        <p>Versão atual nesta data: {current?.revision??0}. Salvar registra uma nova versão com o administrador responsável.</p>
        <button disabled={busy||!date}>{busy?'Salvando…':'Salvar tratamento'}</button>
        {current&&current.value_json!=='null'&&<button type="button" className="company-schedules-secondary"
          disabled={busy||reason.trim().length<10} onClick={e=>void save(e,true)}>Cancelar tratamento com justificativa</button>}
      </form>
      <ul>{loaded.events.map(e=><li key={e.id}>{e.work_date} · {e.kind==='holiday'?'Feriado':e.kind==='occurrence'?'Ocorrência':'Ajuste'} · v{e.revision} · {e.value_json==='null'?'Cancelado':'Vigente'} · {e.reason}</li>)}</ul>
    </>}
  </section>;
}
