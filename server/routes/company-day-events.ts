import { Hono } from 'hono';
import { DateTime } from 'luxon';
import type { App } from '../types';
import { ApiError,ensure } from '../core/errors';
import { limit } from '../core/security';
import { atomicIdentityWrite } from '../core/atomic-identity-write';
import { VALID_COMPANY_ADMIN_WRITE_SQL,companyAdminWriteParams } from '../core/company-admin-write-guard';
import { companyDayEventSchema } from '../../shared/company-day-events';
import { requireCompanyAdmin } from './company-auth';

export const companyDayEventsRoutes=new Hono<App>();
companyDayEventsRoutes.use('*',requireCompanyAdmin);
companyDayEventsRoutes.use('*',async(c,next)=>{
  ensure(c.env.ENABLE_COMPANY_SCHEDULES==='true',503,'day_events_unavailable','Calendário e tratamentos em homologação.');
  await next();
});
companyDayEventsRoutes.get('/',async c=>{
  ensure(Object.entries(c.req.queries()).every(([k,v])=>['month','employee_id'].includes(k)&&v.length===1),400,'invalid_query','Confira os filtros.');
  const month=c.req.query('month')??'',employee=c.req.query('employee_id')??'';
  ensure(/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)&&employee.length>0&&employee.length<=128,400,'invalid_query','Selecione funcionário e mês.');
  const co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!,now=Date.now();
  const guard=companyAdminWriteParams(token,admin,co.id,now),db=c.get('db');
  const scope=`EXISTS(SELECT 1 FROM employees e JOIN companies co ON co.id=e.company_id WHERE e.id=? AND e.company_id=?
    AND e.deleted_at IS NULL AND co.status='active' AND ${VALID_COMPANY_ADMIN_WRITE_SQL})`;
  const rows=await db.batch([
    db.prepare(`SELECT timezone FROM companies WHERE id=? AND ${scope}`).bind(co.id,employee,co.id,...guard),
    db.prepare(`SELECT d.* FROM company_day_events d WHERE d.company_id=? AND (d.employee_id=? OR d.employee_id IS NULL)
      AND substr(d.work_date,1,7)=? AND ${scope} AND NOT EXISTS(SELECT 1 FROM company_day_events n
        WHERE n.company_id=d.company_id AND n.scope_key=d.scope_key AND n.work_date=d.work_date AND n.kind=d.kind AND n.revision>d.revision)
      ORDER BY d.work_date,d.kind LIMIT 94`).bind(co.id,employee,month,employee,co.id,...guard)
  ]);
  ensure(rows[0].results.length===1,404,'employee_not_found','Funcionário não encontrado nesta empresa.');
  ensure(rows[1].results.length<94,409,'event_limit','O período precisa de conferência.');
  return c.json({company_id:co.id,employee_id:employee,month,timezone:(rows[0].results[0] as {timezone:string}).timezone,events:rows[1].results});
});
companyDayEventsRoutes.post('/',async c=>{
  ensure(new URL(c.req.url).search==='',400,'invalid_event','Não informe filtros nesta operação.');
  const parsed=companyDayEventSchema.safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_event','Confira a data, o tratamento e o motivo.');
  const data=parsed.data,co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
  ensure(DateTime.fromISO(data.work_date).isValid,400,'invalid_event_date','Data inválida.');
  ensure(data.kind==='holiday'?data.employee_id===undefined:Boolean(data.employee_id),400,'invalid_event_scope','Confira o funcionário do tratamento.');
  await limit(c,'day-event:'+co.id+':'+admin,100,3600000);
  const db=c.get('db'),now=Date.now();
  const company=await db.prepare("SELECT timezone FROM companies WHERE id=? AND status='active'").bind(co.id).first<{timezone:string}>();
  ensure(company,409,'company_inactive','A empresa está indisponível.');
  const employee=data.employee_id??null;
  if(employee){
    ensure(await db.prepare('SELECT id FROM employees WHERE id=? AND company_id=? AND deleted_at IS NULL').bind(employee,co.id).first(),404,'employee_not_found','Funcionário não encontrado nesta empresa.');
  }
  if(data.kind==='adjustment'&&data.value){
    const marks=data.value.marks;
    ensure(marks.every((m,i)=>Number.isSafeInteger(m)&&m>=0&&m<=now&&(i===0||m>=marks[i-1]))&&
      marks[3]-marks[0]<=24*3600000&&DateTime.fromMillis(marks[0],{zone:company.timezone}).toISODate()===data.work_date,
      400,'invalid_adjustment','Confira a sequência, a data e os horários do ajuste.');
  }
  const scopeKey=employee?'employee:'+employee:'company',id=crypto.randomUUID();
  const adjustmentGuard=data.kind==='adjustment'&&data.value?`AND EXISTS(SELECT 1 FROM work_days w WHERE w.employee_id=? AND w.company_id=? AND w.work_date=? AND w.next_seq>0 AND w.timezone=?)`:'';
  try{
    await atomicIdentityWrite(db,[db.prepare(`INSERT INTO company_day_events(id,company_id,employee_id,scope_key,work_date,kind,revision,value_json,reason,admin_id,created_at)
      SELECT ?,?,?,?,?,?,?+1,?,?,?,? WHERE
      COALESCE((SELECT MAX(revision) FROM company_day_events WHERE company_id=? AND scope_key=? AND work_date=? AND kind=?),0)=?
      AND EXISTS(SELECT 1 FROM companies co WHERE co.id=? AND co.status='active' AND co.timezone=?)
      AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
      AND (? IS NULL OR EXISTS(SELECT 1 FROM employees e WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL))
      AND NOT EXISTS(SELECT 1 FROM monthly_closures m JOIN employees e ON e.id=m.employee_id
        WHERE e.company_id=? AND m.month=substr(?,1,7) AND m.status='closed' AND (? IS NULL OR e.id=?))
      AND NOT EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.company_id=? AND c.month=substr(?,1,7) AND (? IS NULL OR c.employee_id=?))
      ${adjustmentGuard}`)
      .bind(id,co.id,employee,scopeKey,data.work_date,data.kind,data.expected_revision,JSON.stringify(data.value),data.reason,admin,now,
        co.id,scopeKey,data.work_date,data.kind,data.expected_revision,co.id,company.timezone,
        ...companyAdminWriteParams(token,admin,co.id,now),employee,employee,co.id,co.id,data.work_date,employee,employee,
        co.id,data.work_date,employee,employee,
        ...(adjustmentGuard?[employee,co.id,data.work_date,company.timezone]:[]))],'day_event_conflict');
  }catch(error){
    if(error instanceof Error&&/day_event_revision_conflict|UNIQUE constraint/.test(error.message))throw new ApiError(409,'day_event_conflict','O tratamento foi alterado. Atualize os dados.');
    throw error;
  }
  return c.json({success:true,company_id:co.id,id,revision:data.expected_revision+1},201);
});
