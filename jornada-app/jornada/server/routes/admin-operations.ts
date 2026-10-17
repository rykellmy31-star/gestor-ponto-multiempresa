import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App, Ctx } from '../types';
import { body, date, month, parse, rulesSchema, uuid } from '../core/validation';
import { auditStatement, requireRecent, revisionGuard } from '../core/security';
import { ensure } from '../core/errors';
import { fromLocal, localDate, shiftBounds } from '../core/time';
import { sha256 } from '../core/crypto';
import { reportFor, reportsForMonth, rulesFor, scheduleFor } from '../core/reports';
import { generalCsv, reportCsv, reportPdf } from '../core/exports';
export const adminOperations=new Hono<App>();
const settings=(c:Ctx)=>c.get('db').prepare('SELECT * FROM settings WHERE id=1').first<{company_name:string;company_document:string;timezone:string}>();
adminOperations.get('/dashboard',async c=>{
  const config=await settings(c),selectedDate=parse(date,c.req.query('date')||localDate(Date.now(),config!.timezone));
  const selectedMonth=parse(month,c.req.query('month')||selectedDate.slice(0,7));
  const reports=await reportsForMonth(c,selectedMonth);
  const dateReports=selectedDate.slice(0,7)===selectedMonth?reports:await reportsForMonth(c,selectedDate.slice(0,7));
  const rows=dateReports.map(r=>({employee:r.employee,day:r.days.find(d=>d.date===selectedDate)}));
  const active=rows.filter(r=>r.employee.status==='active'&&selectedDate>=r.employee.admission_date&&(!r.employee.employment_end||selectedDate<=r.employee.employment_end));
  const counts={active_employees:active.length,entered:active.filter(r=>r.day!.marks[0]!==null).length,not_entered:active.filter(r=>r.day!.expected_minutes>0&&r.day!.marks[0]===null).length,on_break:active.filter(r=>r.day!.status==='on_break').length,completed:active.filter(r=>r.day!.status==='completed').length,incomplete:rows.filter(r=>r.day!.incomplete).length,pending:reports.reduce((n,r)=>n+r.totals.pending_occurrences+r.days.filter(d=>d.overtime_pending_minutes>0).length,0),worked_minutes:reports.reduce((n,r)=>n+r.totals.worked_minutes,0)};
  const late_employees=rows.filter(r=>r.day!.late_minutes>0).length;
  const trend=(reports[0]?.days||[]).map(d=>({date:d.date,worked_minutes:reports.reduce((n,r)=>n+(r.days.find(day=>day.date===d.date)?.worked_minutes||0),0)}));
  return c.json({date:selectedDate,month:selectedMonth,counts:{...counts,late_employees},rows,trend,server_now:Date.now()});
});
adminOperations.get('/records',async c=>{
  const d=parse(date,c.req.query('date')),id=c.req.query('employee_id')?parse(uuid,c.req.query('employee_id')):undefined;
  const reports=await reportsForMonth(c,d.slice(0,7),id);return c.json(reports.map(r=>({employee:r.employee,day:r.days.find(day=>day.date===d),closure:r.closure})));
});
adminOperations.get('/reports',async c=>{
  const m=parse(month,c.req.query('month'));const reports=await reportsForMonth(c,m);return c.json(reports.map(({employee,totals,closure})=>({employee,totals,closure,month:m})));
});
adminOperations.get('/reports/general.csv',async c=>{
  const m=parse(month,c.req.query('month')),reports=await reportsForMonth(c,m);c.header('Content-Type','text/csv; charset=utf-8');c.header('Content-Disposition',`attachment; filename="relatorio-geral-${m}.csv"`);return c.body(generalCsv(reports));
});
adminOperations.get('/reports/:id',async c=>{
  const id=parse(uuid,c.req.param('id')),m=parse(month,c.req.query('month'));return c.json(await reportFor(c,id,m));
});
adminOperations.get('/reports/:id/:format',async c=>{
  const id=parse(uuid,c.req.param('id')),m=parse(month,c.req.query('month')),format=parse(z.enum(['pdf','csv']),c.req.param('format'));
  const report=await reportFor(c,id,m);c.header('Content-Disposition',`attachment; filename="folha-${report.employee.registration.replace(/[^a-zA-Z0-9-]/g,'_')}-${m}.${format}"`);
  if(format==='csv'){c.header('Content-Type','text/csv; charset=utf-8');return c.body(reportCsv(report));}
  c.header('Content-Type','application/pdf');return c.body((await reportPdf(report)).slice().buffer as ArrayBuffer);
});
adminOperations.post('/adjustments',async c=>{
  requireRecent(c);const input=await body(c,z.object({employee_id:uuid,work_date:date,marks:z.array(z.string().max(19).nullable()).length(4),reason:z.string().trim().min(10).max(2000)}).strict());
  const db=c.get('db'),config=await settings(c),now=Date.now();ensure(input.work_date<=localDate(now,config!.timezone),422,'future_adjustment','Não é permitido ajustar uma data futura.');
  const report=await reportFor(c,input.employee_id,input.work_date.slice(0,7)),dayResult=report.days.find(d=>d.date===input.work_date)!;
  ensure(input.work_date>=report.employee.admission_date&&(!report.employee.employment_end||input.work_date<=report.employee.employment_end),422,'outside_employment','A data está fora do vínculo.');
  ensure(report.closure?.status!=='closed',409,'period_closed','Reabra o período para realizar o ajuste.');
  const day=await db.prepare('SELECT * FROM work_days WHERE employee_id=? AND work_date=?').bind(input.employee_id,input.work_date).first<any>();
  const zone=day?.timezone||config!.timezone,schedule=dayResult.schedule,rules=dayResult.rules;
  ensure(schedule,422,'no_schedule','Atribua uma jornada antes de ajustar este dia.');
  const marks=input.marks.map(m=>m===null?null:fromLocal(m,zone));
  ensure(input.marks.every((m,i)=>m===null||marks[i]!==null),422,'invalid_local_time','Uma data/hora local é inválida ou não existe nesse fuso horário.');
  const values=marks.filter((m):m is number=>m!==null);
  ensure(values.every((m,i)=>m<=now&&(i===0||m>=values[i-1])),422,'invalid_marks','Os horários devem estar em ordem e não podem ser futuros.');
  const min=DateTime.fromISO(input.work_date,{zone}).toMillis(),max=DateTime.fromISO(input.work_date,{zone}).plus({hours:48}).toMillis();
  ensure(values.every(m=>m>=min&&m<max),422,'invalid_shift_dates','Os registros devem pertencer à data de trabalho ou ao dia seguinte.');
  ensure(values.length<2||values.at(-1)!-values[0]<=rules.max_shift_hours*3600000,422,'shift_too_long','A duração supera o limite de turno configurado.');
  const dayId=day?.id||crypto.randomUUID(),id=crypto.randomUUID(),[guard,release]=revisionGuard(c,report.revision);
  const statements=[guard];
  if(!day)statements.push(db.prepare('INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,next_seq,created_at) VALUES(?,?,?,?,?,?,0,?)').bind(dayId,input.employee_id,input.work_date,zone,JSON.stringify(schedule),JSON.stringify(rules),now));
  statements.push(db.prepare('INSERT INTO adjustments(id,work_day_id,payload_json,reason,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(id,dayId,JSON.stringify(marks),input.reason,c.get('principal').id,now));
  statements.push(auditStatement(c,'punch.adjusted','employee',input.employee_id,{date:input.work_date,adjustment_id:id,reason:input.reason,before:dayResult.marks,after:marks}),release);
  await db.batch(statements);return c.json({id,message:'Ajuste salvo. As marcações originais foram preservadas; este dia não aceita novas marcações pelo funcionário.'},201);
});
adminOperations.post('/overtime',async c=>{
  requireRecent(c);const input=await body(c,z.object({employee_id:uuid,work_date:date,status:z.enum(['approved','rejected']),approved_minutes:z.number().int().min(0).max(2160),reason:z.string().trim().min(10).max(2000)}).strict());
  const report=await reportFor(c,input.employee_id,input.work_date.slice(0,7)),day=report.days.find(d=>d.date===input.work_date)!;
  ensure(report.closure?.status!=='closed',409,'period_closed','Reabra o mês para analisar horas positivas.');
  ensure(day.marks.every(m=>m!==null)&&day.positive_minutes>0,422,'no_overtime','Não há horas positivas em um expediente completo para analisar.');
  ensure(input.approved_minutes<=day.positive_minutes&&(input.status!=='rejected'||input.approved_minutes===0),422,'invalid_approval','A aprovação deve respeitar o total de horas positivas; uma recusa deve ter zero minutos.');
  const id=crypto.randomUUID(),[guard,release]=revisionGuard(c,report.revision);
  await c.get('db').batch([
    guard,
    c.get('db').prepare('INSERT INTO overtime_decisions(id,employee_id,work_date,approved_minutes,status,reason,created_by,created_at,basis_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,input.employee_id,input.work_date,input.approved_minutes,input.status,input.reason,c.get('principal').id,Date.now(),sha256(JSON.stringify(day.marks))),
    auditStatement(c,'overtime.reviewed','employee',input.employee_id,input),release,
  ]);return c.json({message:'Conferência de horas positivas registrada.'},201);
});
adminOperations.get('/occurrences',async c=>{
  const m=c.req.query('month')?parse(month,c.req.query('month')):null;
  const rows=await c.get('db').prepare(`SELECT o.*,e.full_name,e.registration,u.display_name created_by_name,r.display_name reviewed_by_name FROM occurrences o JOIN employees e ON e.id=o.employee_id JOIN users u ON u.id=o.created_by LEFT JOIN users r ON r.id=o.reviewed_by ${m?'WHERE substr(o.work_date,1,7)=?':''} ORDER BY o.created_at DESC LIMIT 1000`).bind(...(m?[m]:[])).all();return c.json(rows.results);
});
adminOperations.post('/occurrences',async c=>{
  requireRecent(c);const input=await body(c,z.object({employee_id:uuid,work_date:date,kind:z.enum(['justified_absence','medical','day_off','unjustified_absence','note']),reason:z.string().trim().min(10).max(2000),paid:z.boolean()}).strict());
  const id=crypto.randomUUID(),now=Date.now(),user=c.get('principal');
  const exists=await c.get('db').prepare('SELECT id FROM employees WHERE id=?').bind(input.employee_id).first();ensure(exists,404,'employee_not_found','Funcionário não encontrado.');
  await c.get('db').batch([
    c.get('db').prepare("INSERT INTO occurrences(id,employee_id,work_date,kind,reason,paid,status,created_by,reviewed_by,review_reason,created_at,reviewed_at) VALUES(?,?,?,?,?,?,'approved',?,?,?, ?,?)").bind(id,input.employee_id,input.work_date,input.kind,input.reason,+input.paid,user.id,user.id,'Registro administrativo autorizado',now,now),
    auditStatement(c,'occurrence.created','employee',input.employee_id,{id,...input}),
  ]);return c.json({id,message:'Ocorrência administrativa autorizada e registrada.'},201);
});
adminOperations.post('/occurrences/:id/review',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id')),input=await body(c,z.object({status:z.enum(['approved','rejected']),paid:z.boolean(),reason:z.string().trim().min(10).max(2000)}).strict());
  const old=await c.get('db').prepare('SELECT * FROM occurrences WHERE id=?').bind(id).first<any>();ensure(old,404,'occurrence_not_found','Ocorrência não encontrada.');
  const now=Date.now();await c.get('db').batch([
    c.get('db').prepare('UPDATE occurrences SET status=?,paid=?,review_reason=?,reviewed_by=?,reviewed_at=? WHERE id=?').bind(input.status,+input.paid,input.reason,c.get('principal').id,now,id),
    auditStatement(c,'occurrence.reviewed','employee',old.employee_id,{id,before:{status:old.status,paid:old.paid},after:input}),
  ]);return c.json({message:'Decisão registrada e cálculos atualizados.'});
});
adminOperations.post('/reports/:id/close',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id')),input=await body(c,z.object({month}).strict()),config=await settings(c),now=Date.now();
  ensure(input.month<localDate(now,config!.timezone).slice(0,7),422,'month_not_ended','Apenas meses encerrados podem ser fechados.');
  const report=await reportFor(c,id,input.month);
  ensure(report.closure?.status!=='closed',409,'period_closed','Este mês já está fechado.');
  const last=report.days.at(-1)!;
  ensure(!last.schedule||shiftBounds(last.date,last.schedule,last.timezone).end<=now,422,'shift_not_ended','O último turno do mês ainda não terminou.');
  ensure(!report.days.some(d=>d.marks.some(m=>m!==null)&&d.marks.some(m=>m===null)),409,'incomplete_punches','Existem marcações incompletas. Corrija-as ou registre um ajuste explícito antes do fechamento.');
  ensure(report.totals.pending_occurrences===0&&report.totals.overtime_pending_minutes===0,409,'pending_review','Analise todas as justificativas e horas positivas antes de fechar o mês.');
  ensure(!report.days.some(d=>!d.schedule&&d.date>=report.employee.admission_date&&(!report.employee.employment_end||d.date<=report.employee.employment_end)),409,'no_schedule','Há dias do vínculo sem jornada atribuída. Regularize o cadastro antes de fechar.');
  const closureId=report.closure?.id||crypto.randomUUID(),version=(report.closure?.version||0)+1,snapshot=JSON.stringify({...report,closure:null}),hash=sha256(snapshot),[guard,release]=revisionGuard(c,report.revision),user=c.get('principal');
  await c.get('db').batch([
    guard,
    c.get('db').prepare("INSERT INTO monthly_closures(id,employee_id,month,status,version,snapshot_json,report_hash,closed_by,closed_at) VALUES(?,?,?,'closed',?,?,?,?,?) ON CONFLICT(employee_id,month) DO UPDATE SET status='closed',version=excluded.version,snapshot_json=excluded.snapshot_json,report_hash=excluded.report_hash,closed_by=excluded.closed_by,closed_at=excluded.closed_at,reopened_at=NULL,reopen_reason=NULL WHERE monthly_closures.status='open'").bind(closureId,id,input.month,version,snapshot,hash,user.id,now),
    c.get('db').prepare('INSERT INTO closure_snapshots(id,closure_id,version,snapshot_json,report_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),closureId,version,snapshot,hash,user.id,now),
    auditStatement(c,'period.closed','employee',id,{month:input.month,version,report_hash:hash}),release,
  ]);return c.json({message:'Mês fechado. Relatório congelado e alterações bloqueadas.',report_hash:hash,version});
});
adminOperations.post('/reports/:id/reopen',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id')),input=await body(c,z.object({month,reason:z.string().trim().min(10).max(2000)}).strict());
  const closure=await c.get('db').prepare("SELECT id,version FROM monthly_closures WHERE employee_id=? AND month=? AND status='closed'").bind(id,input.month).first<{id:string;version:number}>();ensure(closure,409,'not_closed','Não há um fechamento ativo para reabrir.');
  await c.get('db').batch([
    c.get('db').prepare("UPDATE monthly_closures SET status='open',reopened_at=?,reopen_reason=? WHERE id=? AND status='closed'").bind(Date.now(),input.reason,closure.id),
    auditStatement(c,'period.reopened','employee',id,{month:input.month,previous_version:closure.version,reason:input.reason}),
  ]);return c.json({message:'Período reaberto. O fechamento anterior permanece no histórico de versões.'});
});
adminOperations.get('/settings',async c=>{
  const config=await settings(c),today=localDate(Date.now(),config!.timezone),db=c.get('db');
  const rules=await rulesFor(c,today),versions=await db.prepare('SELECT id,effective_from,config_json,created_at FROM rule_versions ORDER BY effective_from DESC').all();
  const holidays=await db.prepare('SELECT id,date,name FROM holidays ORDER BY date DESC').all();
  return c.json({company:config,rules,rule_versions:versions.results,holidays:holidays.results,environment:c.env.ENVIRONMENT,email_recovery_enabled:!!(c.env.MAIL_FROM&&c.env.MAIL_API_KEY)});
});
adminOperations.put('/settings',async c=>{
  requireRecent(c);const input=await body(c,z.object({company_name:z.string().trim().min(2).max(140),company_document:z.string().trim().max(30),timezone:z.enum(['America/Bahia','America/Sao_Paulo'])}).strict());
  await c.get('db').batch([
    c.get('db').prepare('UPDATE settings SET company_name=?,company_document=?,timezone=?,updated_at=? WHERE id=1').bind(input.company_name,input.company_document,input.timezone,Date.now()),
    auditStatement(c,'settings.updated','settings','1',input),
  ]);return c.json({message:'Configuração salva. Dias já iniciados e relatórios fechados preservam seus dados históricos.'});
});
adminOperations.post('/rules',async c=>{
  requireRecent(c);const input=await body(c,z.object({effective_from:date,config:rulesSchema}).strict()),config=await settings(c);
  ensure(input.effective_from>=localDate(Date.now(),config!.timezone),422,'retroactive_rule','Não é permitido criar uma regra com vigência retroativa.');
  const id=crypto.randomUUID();await c.get('db').batch([
    c.get('db').prepare('INSERT INTO rule_versions(id,effective_from,config_json,created_by,created_at) VALUES(?,?,?,?,?)').bind(id,input.effective_from,JSON.stringify(input.config),c.get('principal').id,Date.now()),
    auditStatement(c,'rules.version_created','rules',id,input),
  ]);return c.json({id,message:'Versão de cálculo cadastrada. Dias iniciados usam as regras originais.'},201);
});
adminOperations.post('/holidays',async c=>{
  requireRecent(c);const input=await body(c,z.object({date,name:z.string().trim().min(2).max(120)}).strict()),id=crypto.randomUUID();
  await c.get('db').batch([
    c.get('db').prepare('INSERT INTO holidays(id,date,name,created_by,created_at) VALUES(?,?,?,?,?)').bind(id,input.date,input.name,c.get('principal').id,Date.now()),
    auditStatement(c,'holiday.created','holiday',id,input),
  ]);return c.json({id,message:'Feriado cadastrado. Não há jornada prevista nessa data; trabalho realizado será apurado para conferência.'},201);
});
adminOperations.delete('/holidays/:id',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id'));
  const old=await c.get('db').prepare('SELECT date,name FROM holidays WHERE id=?').bind(id).first();ensure(old,404,'holiday_not_found','Feriado não encontrado.');
  await c.get('db').batch([c.get('db').prepare('DELETE FROM holidays WHERE id=?').bind(id),auditStatement(c,'holiday.removed','holiday',id,old)]);return c.json({message:'Feriado removido; histórico de auditoria preservado.'});
});
adminOperations.get('/audit',async c=>{
  const before=c.req.query('before')?parse(z.coerce.number().int().positive(),c.req.query('before')):Number.MAX_SAFE_INTEGER;
  const cursor=c.req.query('before_id')?parse(uuid,c.req.query('before_id')):null;
  const rows=await c.get('db').prepare(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.details_json,a.created_at,u.display_name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE ${cursor?'(a.created_at<? OR (a.created_at=? AND a.id<?))':'a.created_at<?'} ORDER BY a.created_at DESC,a.id DESC LIMIT 200`).bind(...(cursor?[before,before,cursor]:[before])).all();return c.json(rows.results);
});
