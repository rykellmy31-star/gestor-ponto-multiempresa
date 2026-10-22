import { Hono } from 'hono';
import { DateTime } from 'luxon';
import type { App } from '../types';
import { ensure } from '../core/errors';
import { requireCompanyAdmin } from './company-auth';
import { VALID_COMPANY_ADMIN_WRITE_SQL, companyAdminWriteParams } from '../core/company-admin-write-guard';

export const companyAttendanceRoutes = new Hono<App>();
companyAttendanceRoutes.use('*', requireCompanyAdmin);

type Row = {
  work_date:string; timezone:string; next_seq:number;
  punch_id:string|null; seq:number|null; type:string|null;
  recorded_at:number|null; receipt_hash:string|null;
};

// Quoting alone does not prevent spreadsheet formulas in employee names.
export function csvCell(value:unknown):string {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g,'""') + '"';
}

companyAttendanceRoutes.get('/attendance', async c => {
  ensure(c.env.ENABLE_COMPANY_SCHEDULES === 'true',503,
    'company_reports_unavailable','Relatórios empresariais ainda indisponíveis.');
  const company=c.get('company'), admin=c.get('companyAdminId');
  const token=c.get('companyAdminTokenHash');
  ensure(company && admin && token,401,'unauthenticated','Entre na empresa.');
  const queries=c.req.queries();
  ensure(Object.entries(queries).every(([key,values]) =>
    ['employee_id','month','format'].includes(key) && values.length === 1),
    400,'invalid_report_query','Confira os filtros do relatório.');
  const employeeId=c.req.query('employee_id') ?? '';
  const month=c.req.query('month') ?? '';
  const format=c.req.query('format') ?? 'json';
  const from=DateTime.fromISO(month+'-01',{zone:'utc'});
  ensure(employeeId.length>0 && employeeId.length<=128 &&
    /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && from.isValid &&
    ['json','csv'].includes(format),400,'invalid_report_query',
    'Selecione um funcionário e um mês válido.');
  const db=c.get('db'), now=Date.now();
  const auth=companyAdminWriteParams(token,admin,company.id,now);
  // The same session is checked inside each data query, including revocations
  // between middleware and SQL. The company is never supplied by the caller.
  const employee=await db.prepare(`
    SELECT e.id,e.full_name,COALESCE(e.company_registration,e.registration) AS registration FROM employees e
    JOIN companies co ON co.id=e.company_id AND co.status='active'
    WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL
      AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
  `).bind(employeeId,company.id,...auth)
    .first<{id:string;full_name:string;registration:string}>();
  ensure(employee,404,'employee_not_found','Funcionário não encontrado nesta empresa.');
  const result=await db.prepare(`
    SELECT d.work_date,d.timezone,d.next_seq,p.id AS punch_id,
      p.seq,p.type,p.recorded_at,p.receipt_hash
    FROM work_days d
    JOIN employees e ON e.id=d.employee_id AND e.company_id=d.company_id
    JOIN companies co ON co.id=d.company_id AND co.status='active'
    LEFT JOIN punches p ON p.work_day_id=d.id AND p.employee_id=e.id
    WHERE d.company_id=? AND d.employee_id=? AND e.deleted_at IS NULL
      AND d.work_date>=? AND d.work_date<?
      AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
    ORDER BY d.work_date,p.seq LIMIT 150
  `).bind(company.id,employeeId,from.toISODate(),from.plus({months:1}).toISODate(),...auth)
    .all<Row>();
  const rows=result.results ?? [];
  // A valid month has at most 31 days x four marks. Fail rather than truncate.
  ensure(rows.length<150,409,'report_limit','Relatório precisa de conferência.');
  c.header('Cache-Control','private, no-store');
  if(format==='csv') {
    const lines=[['Funcionário','Matrícula','Data','Fuso horário','Sequência','Tipo','Registro UTC','Comprovante'],
      ...rows.map(row=>[employee.full_name,employee.registration,row.work_date,row.timezone,
        row.seq===null?'':row.seq+1,row.type ?? '',
        row.recorded_at===null?'':new Date(row.recorded_at).toISOString(),row.receipt_hash ?? ''])];
    c.header('Content-Type','text/csv; charset=utf-8');
    c.header('Content-Disposition',`attachment; filename="marcacoes-${month}.csv"`);
    return c.body('\uFEFF'+lines.map(line=>line.map(csvCell).join(';')).join('\r\n')+'\r\n');
  }
  return c.json({success:true,company_id:company.id,employee,month,rows});
});


// Dashboard classico com dados do tenant autenticado. Rotas antigas continuam isoladas.
companyAttendanceRoutes.get('/overview',async c=>{
  const company=c.get('company'),admin=c.get('companyAdminId'),token=c.get('companyAdminTokenHash');
  ensure(company&&admin&&token,401,'unauthenticated','Entre na empresa.');
  ensure(Object.entries(c.req.queries()).every(([key,values])=>
    ['date','month'].includes(key)&&values.length===1),
    400,'invalid_overview_query','Confira os filtros.');
  const date=c.req.query('date')||'',month=c.req.query('month')||'';
  const chosen=DateTime.fromISO(date,{zone:'utc'});
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(date)&&chosen.isValid&&chosen.toISODate()===date&&
    /^20\d{2}-(0[1-9]|1[0-2])$/.test(month),
    400,'invalid_overview_query','Informe data e mês válidos.');
  const start=DateTime.fromISO(month+'-01',{zone:'utc'});
  ensure(start.isValid,400,'invalid_overview_query','Mês inválido.');
  const db=c.get('db'),now=Date.now();
  const auth=companyAdminWriteParams(token,admin,company.id,now);
  type EmployeeRow={id:string;full_name:string;registration:string;status:string;next_seq:number|null;
    timezone:string|null;seq:number|null;recorded_at:number|null;schedule_name:string|null};
  type MonthRow={work_date:string;employee_id:string;seq:number|null;recorded_at:number|null};
  // Em ambas consultas, a empresa vem apenas da sessao e a autenticacao e revalidada no SQL.
  const [today,period]=await db.batch([
    db.prepare('SELECT e.id,e.full_name,'+
      'COALESCE(e.company_registration,e.registration) AS registration,'+
      'e.status,d.next_seq,d.timezone,p.seq,p.recorded_at,'+
      '(SELECT sc.name FROM schedule_assignments sa JOIN schedules sc ON sc.id=sa.schedule_id AND sc.company_id=e.company_id '+
      'WHERE sa.employee_id=e.id AND sa.effective_from<=? AND NOT EXISTS(SELECT 1 FROM schedule_assignment_cancellations cac WHERE cac.assignment_id=sa.id) '+
      'ORDER BY sa.effective_from DESC,sa.created_at DESC,sa.id DESC LIMIT 1) AS schedule_name '+
      'FROM employees e JOIN companies co ON co.id=e.company_id AND co.status=\'active\' '+
      'LEFT JOIN work_days d ON d.employee_id=e.id AND d.company_id=e.company_id AND d.work_date=? '+
      'LEFT JOIN punches p ON p.work_day_id=d.id AND p.employee_id=e.id '+
      'WHERE e.company_id=? AND e.deleted_at IS NULL AND '+VALID_COMPANY_ADMIN_WRITE_SQL+
      ' ORDER BY e.full_name,p.seq LIMIT 4000').bind(date,date,company.id,...auth),
    db.prepare('SELECT d.work_date,d.employee_id,p.seq,p.recorded_at '+
      'FROM work_days d JOIN employees e ON e.id=d.employee_id AND e.company_id=d.company_id '+
      'JOIN companies co ON co.id=e.company_id AND co.status=\'active\' '+
      'LEFT JOIN punches p ON p.work_day_id=d.id AND p.employee_id=e.id '+
      'WHERE d.company_id=? AND d.work_date>=? AND d.work_date<? '+
      'AND e.deleted_at IS NULL AND '+VALID_COMPANY_ADMIN_WRITE_SQL+
      ' ORDER BY d.work_date,d.employee_id,p.seq LIMIT 4000')
      .bind(company.id,start.toISODate(),start.plus({months:1}).toISODate(),...auth)
  ]);
  const employees=(today.results||[]) as EmployeeRow[];
  const marks=(period.results||[]) as MonthRow[];
  ensure(employees.length<4000&&marks.length<4000,409,'overview_limit',
    'O volume exige consulta por lotes.');
  function worked(times:(number|null)[]):number {
    const first=times[0]!=null&&times[1]!=null?Math.max(0,times[1]!-times[0]!):0;
    const second=times[2]!=null&&times[3]!=null?Math.max(0,times[3]!-times[2]!):0;
    // Nunca presume tempo aberto, retroativo ou sem os pares de batidas confirmados.
    return Math.floor((first+second)/60000);
  }
  const people=new Map<string,{employee:{id:string;full_name:string;registration:string};
    day:{status:string;timezone:string;marks:(number|null)[];worked_minutes:number;next_seq:number;schedule_name:string|null}}>();
  for(const item of employees){
    let entry=people.get(item.id);
    if(!entry){
      const seq=item.next_seq??0;
      entry={employee:{id:item.id,full_name:item.full_name,registration:item.registration},
        day:{status:item.status!=='active'?'inactive':seq===4?'completed':
          seq===2?'on_break':seq===1||seq===3?'working':'not_started',
          timezone:item.timezone||'America/Sao_Paulo',marks:[null,null,null,null],
          worked_minutes:0,next_seq:seq,schedule_name:item.schedule_name}};
      people.set(item.id,entry);
    }
    if(item.seq!==null&&item.seq>=0&&item.seq<=3)
      entry.day.marks[item.seq]=item.recorded_at;
  }
  const rows=[...people.values()].map(item=>{
    item.day.worked_minutes=worked(item.day.marks);return item;
  });
  const active=rows.filter(item=>item.day.status!=='inactive').length;
  const days=new Map<string,Map<string,(number|null)[]>>();
  for(const item of marks){
    let day=days.get(item.work_date);
    if(!day){day=new Map();days.set(item.work_date,day);}
    let times=day.get(item.employee_id);
    if(!times){times=[null,null,null,null];day.set(item.employee_id,times);}
    if(item.seq!==null&&item.seq>=0&&item.seq<=3)times[item.seq]=item.recorded_at;
  }
  const trend=[] as Array<{date:string;worked_minutes:number}>;
  for(let d=start;d.toMillis()<start.plus({months:1}).toMillis();d=d.plus({days:1})){
    const day=days.get(d.toISODate()!);
    trend.push({date:d.toISODate()!,worked_minutes:day?
      [...day.values()].reduce((sum,t)=>sum+worked(t),0):0});
  }
  const entered=rows.filter(r=>r.day.next_seq>0&&r.day.status!=='inactive').length;
  const countStatus=(status:string)=>rows.filter(r=>r.day.status===status).length;
  c.header('Cache-Control','private, no-store');
  return c.json({company_id:company.id,date,month,rows,trend,
    counts:{active_employees:active,entered,not_entered:Math.max(0,active-entered),
      on_break:countStatus('on_break'),completed:countStatus('completed'),
      incomplete:null,late_employees:null,pending:null,
      worked_minutes:trend.reduce((sum,d)=>sum+d.worked_minutes,0)}});
});
