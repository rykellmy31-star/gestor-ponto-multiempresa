import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App, Ctx, Employee, Schedule } from '../types';
import { auth, auditStatement, ipHash, limit } from '../core/security';
import { body, date, month, parse } from '../core/validation';
import { ensure } from '../core/errors';
import { sha256 } from '../core/crypto';
import { anchorDate, localDate, localTime } from '../core/time';
import { reportFor, rulesFor, scheduleFor } from '../core/reports';
import { calculateDay, sumDays } from '../core/calculations';
import { reportCsv, reportPdf } from '../core/exports';
export const employeeRoutes=new Hono<App>();
employeeRoutes.use('*',auth('employee'));
const punchTypes=['entry','break_start','break_end','exit'] as const;
export async function employeeContext(c:Ctx,employeeId:string){
  const now=Date.now(),db=c.get('db');
  const company=await db.prepare('SELECT company_name,company_document,timezone FROM settings WHERE id=1').first<{company_name:string;company_document:string;timezone:string}>();
  const employee=await db.prepare('SELECT id,full_name,registration,job_title,admission_date,employment_end,status FROM employees WHERE id=?').bind(employeeId).first<Employee>();
  ensure(employee&&company,404,'employee_not_found','Cadastro não encontrado.');
  const today=localDate(now,company.timezone);
  const open=await db.prepare('SELECT * FROM work_days WHERE employee_id=? AND next_seq BETWEEN 1 AND 3 AND created_at>? ORDER BY created_at DESC LIMIT 1').bind(employeeId,now-36*3600000).first<any>();
  let workDate=today;
  if(open&&now-open.created_at<JSON.parse(open.rules_json).max_shift_hours*3600000)workDate=open.work_date;
  else {
    const yesterday=DateTime.fromISO(today).minus({days:1}).toISODate()!;
    const previousSchedule=await scheduleFor(c,employeeId,yesterday);
    if(previousSchedule&&anchorDate(now,previousSchedule,company.timezone)===yesterday&&previousSchedule.weekdays.includes(DateTime.fromISO(yesterday).weekday%7))workDate=yesterday;
  }
  const day=open?.work_date===workDate?open:await db.prepare('SELECT * FROM work_days WHERE employee_id=? AND work_date=?').bind(employeeId,workDate).first<any>();
  const schedule:Schedule|null=day?JSON.parse(day.schedule_json):await scheduleFor(c,employeeId,workDate);
  const rules=day?JSON.parse(day.rules_json):await rulesFor(c,workDate);
  return {now,company,employee,today,workDate,day,schedule,rules};
}
employeeRoutes.get('/today',async c=>{
  const id=c.get('principal').employee_id!,ctx=await employeeContext(c,id),db=c.get('db');
  const report=await reportFor(c,id,ctx.workDate.slice(0,7));
  const result=report.days.find(d=>d.date===ctx.workDate)!;
  const punches=ctx.day?(await db.prepare('SELECT id,type,seq,recorded_at,receipt_hash FROM punches WHERE work_day_id=? ORDER BY seq').bind(ctx.day.id).all()).results:[];
  const adjusted=ctx.day?await db.prepare('SELECT 1 ok FROM adjustments WHERE work_day_id=? LIMIT 1').bind(ctx.day.id).first():null;
  const live=calculateDay({date:ctx.workDate,timezone:result.timezone,schedule:result.schedule,rules:result.rules,marks:result.marks,now:ctx.now,occurrences:[],employed:ctx.workDate>=ctx.employee.admission_date&&(!ctx.employee.employment_end||ctx.workDate<=ctx.employee.employment_end),live:true});
  return c.json({employee:ctx.employee,company:ctx.company,date:ctx.workDate,server_now:ctx.now,day:{...result,worked_minutes:live.worked_minutes},next_seq:adjusted?4:(ctx.day?.next_seq||0),punches,adjusted:!!adjusted,month_totals:report.totals,closure:report.closure});
});
employeeRoutes.post('/punch',async c=>{
  const input=await body(c,z.object({type:z.enum(punchTypes),idempotency_key:z.string().uuid()}).strict());
  const employeeId=c.get('principal').employee_id!,db=c.get('db');
  await limit(c,`punch:${employeeId}`,60,60000);
  const existing=await db.prepare('SELECT p.id,p.type,p.recorded_at,p.receipt_hash,d.work_date,d.timezone FROM punches p JOIN work_days d ON d.id=p.work_day_id WHERE p.employee_id=? AND p.idempotency_key=?').bind(employeeId,input.idempotency_key).first<any>();
  if(existing){ensure(existing.type===input.type,409,'idempotency_conflict','Esta chave de confirmação já foi usada para outro tipo de registro.');return c.json({message:'Registro já confirmado anteriormente.',punch:existing,replayed:true});}
  const ctx=await employeeContext(c,employeeId);
  ensure(ctx.employee.status==='active',403,'inactive_employee','Seu acesso não está ativo.');
  ensure(ctx.workDate>=ctx.employee.admission_date&&(!ctx.employee.employment_end||ctx.workDate<=ctx.employee.employment_end),409,'outside_employment','A data está fora do vínculo cadastrado. Contate o RH.');
  ensure(ctx.schedule,409,'no_schedule','Nenhuma jornada foi atribuída. Contate o administrador.');
  const seq=punchTypes.indexOf(input.type);
  ensure(seq===(ctx.day?.next_seq||0),409,'invalid_sequence','A sequência de marcação mudou. Atualize a tela antes de registrar novamente.');
  const id=crypto.randomUUID(),dayId=ctx.day?.id||crypto.randomUUID(),now=Date.now();
  const receiptHash=sha256(JSON.stringify({id,employeeId,workDate:ctx.workDate,type:input.type,at:now}));
  const statements=[];
  if(!ctx.day)statements.push(db.prepare('INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,next_seq,created_at) VALUES(?,?,?,?,?,?,0,?) ON CONFLICT(employee_id,work_date) DO NOTHING').bind(dayId,employeeId,ctx.workDate,ctx.company.timezone,JSON.stringify(ctx.schedule),JSON.stringify(ctx.rules),now));
  statements.push(db.prepare('INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash) VALUES(?,(SELECT id FROM work_days WHERE employee_id=? AND work_date=?),?,?,?,?,?,?,?)').bind(id,employeeId,ctx.workDate,employeeId,seq,input.type,now,input.idempotency_key,ipHash(c),receiptHash));
  await db.batch(statements);
  return c.json({message:`Ponto confirmado às ${localTime(now,ctx.day?.timezone||ctx.company.timezone)}.`,punch:{id,type:input.type,recorded_at:now,work_date:ctx.workDate,receipt_hash:receiptHash},replayed:false},201);
});
employeeRoutes.get('/report',async c=>{
  const m=parse(month,c.req.query('month'));
  return c.json(await reportFor(c,c.get('principal').employee_id!,m));
});
employeeRoutes.get('/week',async c=>{
  const d=parse(date,c.req.query('date')),start=DateTime.fromISO(d).startOf('week'),end=start.plus({days:6});
  const months=[...new Set([start.toFormat('yyyy-MM'),end.toFormat('yyyy-MM')])];
  const reports=[];for(const m of months)reports.push(await reportFor(c,c.get('principal').employee_id!,m));
  const days=reports.flatMap(r=>r.days).filter(v=>v.date>=start.toISODate()!&&v.date<=end.toISODate()!);
  return c.json({from:start.toISODate(),to:end.toISODate(),days,totals:sumDays(days)});
});
employeeRoutes.get('/report/:format',async c=>{
  const format=parse(z.enum(['pdf','csv']),c.req.param('format')),m=parse(month,c.req.query('month'));
  const r=await reportFor(c,c.get('principal').employee_id!,m);
  c.header('Content-Disposition',`attachment; filename="folha-${r.employee.registration.replace(/[^a-zA-Z0-9-]/g,'_')}-${m}.${format}"`);
  if(format==='csv'){c.header('Content-Type','text/csv; charset=utf-8');return c.body(reportCsv(r));}
  c.header('Content-Type','application/pdf');return c.body((await reportPdf(r)).slice().buffer as ArrayBuffer);
});
employeeRoutes.get('/occurrences',async c=>{
  const id=c.get('principal').employee_id!;
  const rows=await c.get('db').prepare('SELECT id,work_date,kind,reason,paid,status,review_reason,created_at,reviewed_at FROM occurrences WHERE employee_id=? ORDER BY work_date DESC,created_at DESC LIMIT 300').bind(id).all();return c.json(rows.results);
});
employeeRoutes.post('/occurrences',async c=>{
  const input=await body(c,z.object({work_date:date,kind:z.enum(['justified_absence','medical','note']),reason:z.string().trim().min(10).max(2000)}).strict());
  const id=crypto.randomUUID(),user=c.get('principal');await limit(c,`occurrence:${user.id}`,20,3600000);
  await c.get('db').batch([
    c.get('db').prepare('INSERT INTO occurrences(id,employee_id,work_date,kind,reason,paid,status,created_by,created_at) VALUES(?,?,?,?,?,0,\'pending\',?,?)').bind(id,user.employee_id,input.work_date,input.kind,input.reason,user.id,Date.now()),
    auditStatement(c,'occurrence.requested','occurrence',id,{date:input.work_date,kind:input.kind}),
  ]);return c.json({id,message:'Solicitação enviada para análise do RH.'},201);
});
