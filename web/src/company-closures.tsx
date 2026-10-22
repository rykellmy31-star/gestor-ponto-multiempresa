import { useEffect,useRef,useState,type FormEvent } from 'react';
import { Field } from './ui';
import { jsonRequest,isExpiredCompanySession } from './company-schedules-network';
type Period={company_id:string;employee_id:string;month:string;revision:number;state:'open'|'closed';snapshot_hash?:string;
  problems:string[];report:{source_version:number;totals:{expected_minutes:number;worked_minutes:number;credited_minutes:number;raw_balance_minutes:number};coverage:{review_days:number};days:Array<{date:string;result:{worked_minutes:number;raw_balance_minutes:number;notes:string[]}|null}>}};
export function CompanyClosures({companyId,employees,csrf,onSessionExpired}:{companyId:string;employees:Array<{id:string;full_name:string}>;csrf:string;onSessionExpired:()=>void}) {
  const [employee,setEmployee]=useState(''),[month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [period,setPeriod]=useState<Period|null>(null),[reason,setReason]=useState(''),[password,setPassword]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  function clear(){pending.current?.abort();setPeriod(null);setPassword('');setReason('');setError('');}
  async function read(){
    const controller=new AbortController();pending.current?.abort();pending.current=controller;
    const data=await jsonRequest<Period>('/company/closures?'+new URLSearchParams({employee_id:employee,month}),{signal:controller.signal});
    if(controller.signal.aborted)return;
    if(data.company_id!==companyId||data.employee_id!==employee||data.month!==month)throw new Error('Período não confirmado nesta empresa.');
    setPeriod(data);
  }
  async function consult(event:FormEvent){event.preventDefault();clear();setBusy(true);
    try{await read();}catch(e){if(isExpiredCompanySession(e))onSessionExpired();else setError(e instanceof Error?e.message:'Não foi possível consultar.');}finally{setBusy(false);}}
  async function save(event:FormEvent){event.preventDefault();if(!period||busy)return;setBusy(true);setError('');
    try{
      await jsonRequest('/company/closures',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({employee_id:employee,month,
        state:period.state==='closed'?'open':'closed',expected_revision:period.revision,expected_source_version:period.report.source_version,reason,current_password:password})});
      setPassword('');setReason('');await read();
    }catch(e){setPassword('');setPeriod(null);if(isExpiredCompanySession(e))onSessionExpired();else setError(e instanceof Error?e.message:'Consulte novamente antes de tentar.');}finally{setBusy(false);}}
  return <section className="company-schedules-card">
    <h2>Fechamento mensal</h2>
    <p>Confira o mês encerrado antes de confirmar. O fechamento preserva uma cópia dos cálculos e bloqueia alterações no período. Reabrir exige sua senha e justificativa, mantendo a versão anterior.</p>
    <form onSubmit={consult} className="company-schedules-assign">
      <Field label="Funcionário do fechamento"><select required value={employee} disabled={busy} onChange={e=>{clear();setEmployee(e.target.value);}}><option value="">Selecione</option>{employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
      <Field label="Mês do fechamento"><input type="month" required min="2000-01" max="2099-12" disabled={busy} value={month} onChange={e=>{clear();setMonth(e.target.value);}}/></Field>
      <button disabled={busy}>Consultar fechamento</button>
    </form>
    {error&&<p role="alert" className="company-schedules-error">{error}</p>}
    {period&&<>
      <p role="status">{period.state==='closed'?'Período fechado':'Período aberto'} · revisão {period.revision}</p>
      {period.snapshot_hash&&<p style={{overflowWrap:'anywhere'}}>Identificação do fechamento: {period.snapshot_hash}</p>}
      <p>Minutos previstos: {period.report.totals.expected_minutes} · trabalhados: {period.report.totals.worked_minutes} · abonados: {period.report.totals.credited_minutes} · saldo bruto: {period.report.totals.raw_balance_minutes}.</p>
      <ul>{period.problems.map(p=><li key={p}>{p}</li>)}</ul>
      <details><summary>Conferir dias do período</summary><ul>{period.report.days.map(d=><li key={d.date}>{d.date}: {d.result?`${d.result.worked_minutes} min trabalhados; saldo bruto ${d.result.raw_balance_minutes} min. ${d.result.notes.join(' · ')}`:'Fora do cálculo — confira o histórico.'}</li>)}</ul></details>
      {(period.state==='closed'||period.problems.length===0)&&<form key={period.revision} onSubmit={save} className="company-employee-registration">
        <Field label="Justificativa do fechamento ou reabertura"><textarea required minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></Field>
        <Field label="Senha para confirmar o período"><input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></Field>
        <label><input type="checkbox" required disabled={busy}/> Conferi os dados e confirmo esta operação no período selecionado.</label>
        <button disabled={busy}>{period.state==='closed'?'Reabrir mês com auditoria':'Confirmar fechamento do mês'}</button>
      </form>}
    </>}
  </section>;
}
