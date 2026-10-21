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
