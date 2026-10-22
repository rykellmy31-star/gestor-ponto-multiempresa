import { Hono } from 'hono';
import { DateTime } from 'luxon';
import type { App } from '../types';
import { ensure } from '../core/errors';
import { requireCompanyAdmin } from './company-auth';
import { VALID_COMPANY_ADMIN_WRITE_SQL,companyAdminWriteParams } from '../core/company-admin-write-guard';
import { calculateCompanyMonth,type CalculationPolicy,type CalculationPunch,
  type CalculationSchedule,type CalculationWorkDay } from '../core/company-calculations';
import { companyCalculationStatuses } from '../../shared/company-calculation-status';
import { csvCell } from './company-attendance';
import type { CompanyDayEvent } from '../../shared/company-day-events';

export const companyCalculationsRoutes=new Hono<App>();
companyCalculationsRoutes.use('*',requireCompanyAdmin);
companyCalculationsRoutes.get('/calculations',async c=>{
  ensure(c.env.ENABLE_COMPANY_SCHEDULES==='true',503,'company_reports_unavailable','Apuração ainda em homologação.');
  ensure(Object.entries(c.req.queries()).every(([key,values])=>
    ['employee_id','month','format'].includes(key) && values.length===1),400,
    'invalid_report_query','Confira os filtros da apuração.');
  const employeeId=c.req.query('employee_id')??'',month=c.req.query('month')??'';
  const format=c.req.query('format')??'json';
  ensure(employeeId.length>0 && employeeId.length<=128 && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) &&
    ['json','csv'].includes(format),400,'invalid_report_query','Selecione funcionário e mês válidos.');
  const company=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
  const now=Date.now(),db=c.get('db'),first=month+'-01';
  const from=DateTime.fromISO(first,{zone:'utc'}),end=from.plus({months:1}).toISODate()!;
  const lower=from.minus({days:2}).toMillis(),upper=from.plus({months:1,days:2}).toMillis();
  // Each data query is scoped to the same employee/company AND revalidates
  // authorization. D1.batch provides one consistent read transaction.
  const scope=`FROM employees e JOIN companies co ON co.id=e.company_id
    WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL AND co.status='active'
      AND ${VALID_COMPANY_ADMIN_WRITE_SQL}`;
  const params=[employeeId,company.id,...companyAdminWriteParams(token,admin,company.id,now)];
  const owned=`EXISTS(SELECT 1 ${scope})`;
  const results=await db.batch([
    db.prepare(`SELECT e.id,e.full_name,COALESCE(e.company_registration,e.registration) registration,
      e.admission_date,e.employment_end,co.timezone ${scope}`).bind(...params),
    db.prepare(`SELECT d.id,d.company_id,d.work_date,d.timezone,d.schedule_json,d.rules_json,d.next_seq
      FROM work_days d WHERE d.employee_id=? AND (d.company_id=? OR d.company_id IS NULL)
      AND d.work_date>=? AND d.work_date<? AND ${owned} ORDER BY d.work_date LIMIT 32`)
      .bind(employeeId,company.id,first,end,...params),
    db.prepare(`SELECT p.work_day_id,p.seq,p.type,p.recorded_at FROM punches p
      JOIN work_days d ON d.id=p.work_day_id AND d.employee_id=p.employee_id
      WHERE p.employee_id=? AND d.company_id=? AND d.work_date>=? AND d.work_date<?
      AND ${owned} ORDER BY d.work_date,p.seq LIMIT 125`).bind(employeeId,company.id,first,end,...params),
    db.prepare(`WITH RECURSIVE dates(work_date) AS (
      SELECT ? UNION ALL SELECT date(work_date,'+1 day') FROM dates WHERE date(work_date,'+1 day')<?)
      SELECT dates.work_date,
      (SELECT COALESCE(h.config_json,s.config_json) FROM schedule_assignments a
        JOIN schedules s ON s.id=a.schedule_id AND s.company_id=?
        LEFT JOIN schedule_history h ON h.id=(SELECT sh.id FROM schedule_history sh
          WHERE sh.schedule_id=a.schedule_id AND sh.effective_from<=dates.work_date
          ORDER BY sh.effective_from DESC,sh.id DESC LIMIT 1)
        WHERE a.employee_id=? AND a.effective_from<=dates.work_date
          AND NOT EXISTS(SELECT 1 FROM schedule_assignment_cancellations cac WHERE cac.assignment_id=a.id)
        ORDER BY a.effective_from DESC,a.created_at DESC,a.id DESC LIMIT 1) AS config_json,
      (SELECT a.created_at FROM schedule_assignments a
        JOIN schedules s ON s.id=a.schedule_id AND s.company_id=?
        WHERE a.employee_id=? AND a.effective_from<=dates.work_date
          AND NOT EXISTS(SELECT 1 FROM schedule_assignment_cancellations cac WHERE cac.assignment_id=a.id)
        ORDER BY a.effective_from DESC,a.created_at DESC,a.id DESC LIMIT 1) AS assignment_created_at
      FROM dates WHERE ${owned}`)
      .bind(first,end,company.id,employeeId,company.id,employeeId,...params),
    db.prepare(`SELECT enabled,rules_json,created_at,revision FROM company_punch_policy_audit p
      WHERE p.company_id=? AND p.created_at<=? AND (p.created_at>=? OR p.id=(
        SELECT prior.id FROM company_punch_policy_audit prior WHERE prior.company_id=p.company_id
        AND prior.created_at<? ORDER BY prior.created_at DESC,prior.revision DESC LIMIT 1))
      AND ${owned} ORDER BY p.created_at,p.revision LIMIT 1001`)
      .bind(company.id,upper,lower,lower,...params),
    // Old occurrence/decision/closure tables have no proven tenant history.
    // Do not silently apply them or expose their contents through this API.
    db.prepare(`SELECT 1 AS pending ${scope} AND (
      EXISTS(SELECT 1 FROM occurrences o WHERE o.employee_id=e.id AND o.work_date>=? AND o.work_date<?)
      OR EXISTS(SELECT 1 FROM overtime_decisions o WHERE o.employee_id=e.id AND o.work_date>=? AND o.work_date<?)
      OR EXISTS(SELECT 1 FROM monthly_closures m WHERE m.employee_id=e.id AND m.month=?)
      OR EXISTS(SELECT 1 FROM adjustments a JOIN work_days d ON d.id=a.work_day_id
        WHERE d.employee_id=e.id AND d.company_id=e.company_id AND d.work_date>=? AND d.work_date<?))
      LIMIT 1`).bind(...params,first,end,first,end,month,first,end),
    db.prepare(`SELECT d.* FROM company_day_events d WHERE d.company_id=? AND (d.employee_id=? OR d.employee_id IS NULL)
      AND d.work_date>=? AND d.work_date<? AND ${owned}
      AND NOT EXISTS(SELECT 1 FROM company_day_events n WHERE n.company_id=d.company_id AND n.scope_key=d.scope_key
        AND n.work_date=d.work_date AND n.kind=d.kind AND n.revision>d.revision)
      ORDER BY d.work_date,d.kind LIMIT 94`).bind(company.id,employeeId,first,end,...params)
  ]);
  const employee=results[0].results[0] as unknown as {id:string;full_name:string;registration:string;
    admission_date:string;employment_end:string|null;timezone:string}|undefined;
  ensure(employee,404,'employee_not_found','Funcionário não encontrado nesta empresa.');
  ensure(results[1].results.length<32 && results[2].results.length<125 && results[4].results.length<1001,
    409,'report_limit','O volume do histórico exige conferência.');
  ensure(results[5].results.length===0,409,'company_report_reconciliation_required',
    'Ocorrências, ajustes ou fechamentos antigos exigem conciliação empresarial antes da apuração.');
  ensure(results[6].results.length<94,409,'report_limit','Tratamentos excedem o limite de conferência.');
  const report=calculateCompanyMonth({month,now,timezone:employee.timezone,
    admission_date:employee.admission_date,employment_end:employee.employment_end,
    workDays:results[1].results as unknown as CalculationWorkDay[],
    punches:results[2].results as unknown as CalculationPunch[],
    schedules:results[3].results as unknown as CalculationSchedule[],
    policies:results[4].results as unknown as CalculationPolicy[],events:results[6].results as unknown as CompanyDayEvent[]});
  c.header('Cache-Control','private, no-store');
  if(format==='csv') {
    const lines=[['Apuração provisória — conferir ocorrências e feriados antes do fechamento'],
      ['Funcionário','Matrícula','Data','Situação','Previsto (min)','Trabalhado (min)','Intervalo (min)',
        'Atraso (min)','Saída antecipada (min)','Saldo bruto (min)','Extras pendentes (min)','Conferência'],
      ...report.days.map(day=>[employee.full_name,employee.registration,day.date,companyCalculationStatuses[day.result?.status??day.state]??'Conferência necessária',
        day.result?.expected_minutes??'',day.result?.worked_minutes??'',day.result?.break_minutes??'',
        day.result?.late_minutes??'',day.result?.early_minutes??'',day.result?.raw_balance_minutes??'',
        day.result?.overtime_pending_minutes??'',day.reason??day.result?.notes.join(' | ')??''])];
    c.header('Content-Type','text/csv; charset=utf-8');
    c.header('Content-Disposition',`attachment; filename="apuracao-${month}.csv"`);
    return c.body('\uFEFF'+lines.map(line=>line.map(csvCell).join(';')).join('\r\n')+'\r\n');
  }
  return c.json({company_id:company.id,employee,month,generated_at:now,provisional:true,
    notice:'Confira ocorrências e feriados antes de usar estes valores no fechamento. Dias sem histórico suficiente não geram faltas presumidas.',...report});
});
