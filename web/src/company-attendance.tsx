import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isExpiredCompanySession, jsonRequest } from './company-schedules-network';

type Report = {
  company_id:string; month:string;
  employee:{id:string;full_name:string;registration:string};
  rows:Array<{work_date:string;timezone:string;next_seq:number;punch_id:string|null;
    seq:number|null;type:string|null;recorded_at:number|null;receipt_hash:string|null}>;
};
const labels:Record<string,string>={entry:'Entrada',break_start:'Início do intervalo',
  break_end:'Retorno do intervalo',exit:'Saída'};

export function CompanyAttendance({companyId,employees,onSessionExpired}:{
  companyId:string;employees:Array<{id:string;full_name:string}>;onSessionExpired:()=>void
}) {
  const [employee,setEmployee]=useState('');
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [report,setReport]=useState<Report|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  function invalidate() {
    pending.current?.abort(); pending.current=null;
    setReport(null);setError('');setBusy(false);
  }
  async function load(event:FormEvent) {
    event.preventDefault();invalidate();
    const controller=new AbortController();pending.current=controller;setBusy(true);
    try {
      const data=await jsonRequest<Report>('/company/reports/attendance?'+
        new URLSearchParams({employee_id:employee,month}),{signal:controller.signal});
      if(controller.signal.aborted)return;
      if(data.company_id!==companyId || data.employee.id!==employee || data.month!==month)
        throw new Error('A sessão empresarial mudou. Entre novamente.');
      setReport(data);
    } catch(err) {
      if(controller.signal.aborted)return;
      if(isExpiredCompanySession(err))onSessionExpired();
      else setError(err instanceof Error?err.message:'Falha ao consultar marcações.');
    } finally {if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  return <section className="company-schedules-card">
    <h2>Relatório mensal de marcações</h2>
    <p>Consulte os registros confirmados de cada funcionário. Dias sem registros não representam, por si só, falta ou folga.</p>
    <form onSubmit={event=>void load(event)}>
      <label>Funcionário <select required value={employee} onChange={e=>{invalidate();setEmployee(e.target.value);}}>
        <option value="">Selecione</option>
        {employees.map(person=><option key={person.id} value={person.id}>{person.full_name}</option>)}
      </select></label>{' '}
      <label>Mês <input required type="month" min="2000-01" max="2099-12" value={month}
        onChange={e=>{invalidate();setMonth(e.target.value);}}/></label>{' '}
      <button className="company-schedules-secondary" disabled={busy||!employee}>
        {busy?'Consultando…':'Consultar marcações'}</button>
    </form>
    {error&&<p role="alert" className="company-schedules-error">{error}</p>}
    {report&&<>
      <h3>{report.employee.full_name} · {report.month}</h3>
      <a href={'/api/company/reports/attendance?'+new URLSearchParams({
        employee_id:report.employee.id,month:report.month,format:'csv'})}>Exportar CSV</a>
      {report.rows.length===0?<p role="status">Nenhuma marcação encontrada neste mês.</p>:
        <div style={{overflowX:'auto'}}><table>
          <thead><tr><th>Data</th><th>Marcação</th><th>Horário local</th><th>Fuso horário</th><th>Comprovante</th></tr></thead>
          <tbody>{report.rows.map((row,i)=><tr key={row.punch_id??'day-'+i}>
            <td>{row.work_date}</td><td>{row.type?labels[row.type]??row.type:'Sem marcações'}</td>
            <td>{row.recorded_at===null?'—':new Intl.DateTimeFormat('pt-BR',{
              timeZone:row.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'
            }).format(new Date(row.recorded_at))}</td><td>{row.timezone}</td>
            <td style={{overflowWrap:'anywhere',maxWidth:220}}>{row.receipt_hash??'—'}</td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </section>;
}
