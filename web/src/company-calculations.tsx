import { useEffect,useId,useRef,useState,type FormEvent } from 'react';
import { companyCalculationStatuses as statuses } from '../../shared/company-calculation-status';
import type { DayResult,Totals } from '../../server/types';
import { isExpiredCompanySession,jsonRequest } from './company-schedules-network';
type Calculation={company_id:string;month:string;provisional:true;notice:string;
  employee:{id:string;full_name:string};totals:Totals;
  coverage:{calculated_days:number;review_days:number;future_days:number;outside_employment_days:number};
  days:Array<{date:string;state:string;reason:string|null;result:DayResult|null}>};
const duration=(minutes:number)=>{
  const n=Math.abs(minutes);return (minutes<0?'−':'')+Math.floor(n/60)+'h'+String(n%60).padStart(2,'0');
};
export function CompanyCalculations({companyId,employees,onSessionExpired}:{companyId:string;
  employees:Array<{id:string;full_name:string}>;onSessionExpired:()=>void}) {
  const id=useId(),pending=useRef<AbortController|null>(null);
  const [employee,setEmployee]=useState(''),[month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [report,setReport]=useState<Calculation|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>()=>pending.current?.abort(),[]);
  function clear(){pending.current?.abort();pending.current=null;setReport(null);setError('');setBusy(false);}
  async function load(event:FormEvent){
    event.preventDefault();clear();const controller=new AbortController();pending.current=controller;setBusy(true);
    try {
      const data=await jsonRequest<Calculation>('/company/reports/calculations?'+new URLSearchParams({employee_id:employee,month}),{signal:controller.signal});
      if(controller.signal.aborted)return;
      if(data.company_id!==companyId||data.employee.id!==employee||data.month!==month||data.provisional!==true)
        throw new Error('Resposta não confirmada. Entre novamente na empresa.');
      setReport(data);
    }catch(err){
      if(controller.signal.aborted)return;
      if(isExpiredCompanySession(err))onSessionExpired();
      else setError(err instanceof Error?err.message:'Não foi possível apurar as jornadas.');
    }finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  return <section className="company-schedules-card">
    <h2>Apuração de jornadas</h2>
    <p>Confira horas, intervalos, atrasos e dias sem marcações. A apuração é provisória e exige conferência de ocorrências e feriados antes do fechamento.</p>
    <form onSubmit={event=>void load(event)}>
      <label htmlFor={id+'-employee'}>Funcionário</label>{' '}
      <select id={id+'-employee'} value={employee} required onChange={e=>{clear();setEmployee(e.target.value);}}>
        <option value="">Selecione</option>{employees.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>{' '}<label htmlFor={id+'-month'}>Mês</label>{' '}
      <input id={id+'-month'} type="month" required min="2000-01" max="2099-12" value={month}
        onChange={e=>{clear();setMonth(e.target.value);}}/>{' '}
      <button className="company-schedules-secondary" disabled={busy||!employee}>{busy?'Apurando…':'Apurar jornadas'}</button>
    </form>
    {error&&<p role="alert" className="company-schedules-error">{error}</p>}
    {report&&<>
      <h3>{report.employee.full_name} · {report.month}</h3>
      <p role="status">{report.notice}</p>
      <p>Dias calculados: {report.coverage.calculated_days} · Dias que exigem conferência: {report.coverage.review_days}</p>
      <p>Previsto nos dias calculados: <strong>{duration(report.totals.expected_minutes)}</strong> ·
        Trabalhado: <strong>{duration(report.totals.worked_minutes)}</strong> ·
        Atrasos: <strong>{duration(report.totals.late_minutes)}</strong> ·
        Saldo bruto: <strong>{duration(report.totals.raw_balance_minutes)}</strong> ·
        Extras aguardando aprovação: <strong>{duration(report.totals.overtime_pending_minutes)}</strong></p>
      <p>Ausências a conferir: {report.totals.absences}. Dias sem histórico suficiente e datas futuras não geram faltas presumidas.</p>
      <a href={'/api/company/reports/calculations?'+new URLSearchParams({employee_id:report.employee.id,month:report.month,format:'csv'})}>Exportar apuração CSV</a>
      <div style={{overflowX:'auto'}}><table>
        <thead><tr><th>Data</th><th>Situação</th><th>Previsto</th><th>Trabalhado</th><th>Intervalo</th><th>Atraso</th><th>Saldo bruto</th><th>Conferência</th></tr></thead>
        <tbody>{report.days.map(day=><tr key={day.date}>
          <td>{day.date}</td><td>{statuses[day.result?.status??day.state]??'Conferência necessária'}</td>
          {(['expected_minutes','worked_minutes','break_minutes','late_minutes','raw_balance_minutes'] as const).map(key=>
            <td key={key}>{day.result?duration(day.result[key]):'—'}</td>)}
          <td>{day.reason??day.result?.notes.join(' · ')??'—'}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
