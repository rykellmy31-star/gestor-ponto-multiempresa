import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App, Ctx, Schedule, Rules } from '../types';
import { ensure, ApiError } from '../core/errors';
import { sha256, safeEqual } from '../core/crypto';
import { limit, ipHash } from '../core/security';
import { localDate, scheduleMinutes, shiftBounds, scheduleForDate } from '../core/time';
import { getEmployeeCpfSession, type ActiveSession } from './employee-cpf-auth';
import { canUseFrozenCompanyWorkday } from '../core/workday-start-state';
import { SELECT_ACTIVE_COMPANY_SCHEDULE_SQL, CURRENT_ACTIVE_ASSIGNMENT_ID_SQL, CURRENT_ASSIGNMENT_CONFIG_SQL } from '../core/active-company-schedule';

export const employeeCpfPunchRoutes = new Hono<App>();
export const cpfPunchTypes = ['entry','break_start','break_end','exit'] as const;
type PunchType = typeof cpfPunchTypes[number];

const requestSchema = z.object({
  type:z.enum(cpfPunchTypes), idempotency_key:z.string().uuid()
}).strict();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const shiftSchema = z.object({
  start:hhmm, break_start:hhmm, break_end:hhmm, end:hhmm,
  weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),
  paid_break:z.boolean()
}).passthrough();
const rulesSchema = z.object({
  mark_tolerance:z.number().int().min(0).max(60),
  daily_tolerance:z.number().int().min(0).max(120),
  rounding_step:z.number().int().min(1).max(60),
  rounding_mode:z.enum(['floor','nearest','ceil']),
  auto_approve_overtime:z.boolean(),
  compensation:z.enum(['review','bank']),
  max_shift_hours:z.number().min(1).max(24)
}).passthrough();

type Eligibility = {
  timezone:'America/Bahia'|'America/Sao_Paulo';
  admission_date:string;
  employment_end:string|null;
  rules_json:string;
};
type Day = {
  id:string; company_id:string|null; next_seq:number;
  schedule_json:string; rules_json:string; timezone:string;
};
type Previous = {
  id:string; type:PunchType; recorded_at:number; receipt_hash:string;
  work_date:string; timezone:string; company_id:string|null;
};

async function authorized(c:Ctx, write:boolean):Promise<ActiveSession> {
  const s = await getEmployeeCpfSession(c);
  ensure(s,401,'unauthenticated','Entre para acessar o ponto.');
  ensure(!s.must_change_password,403,'password_change_required',
    'Altere a senha inicial antes de registrar ponto.');
  if(write) ensure(safeEqual(c.req.header('X-CSRF-Token')||'',s.csrf_token),
    403,'csrf','Atualize a sessão antes de registrar o ponto.');
  ensure(c.env.ENABLE_EMPLOYEE_PUNCHES==='true',503,'punch_not_enabled',
    'O registro de ponto está em homologação.');
  return s;
}

async function loadContext(c:Ctx,s:ActiveSession,now:number) {
  const db=c.get('db');
  const employee=await db.prepare([
    'SELECT co.timezone,e.admission_date,e.employment_end,pol.rules_json',
    'FROM employee_company_sessions sess',
    'JOIN users u ON u.id=sess.user_id AND u.employee_id=sess.employee_id',
    "AND u.auth_version=sess.auth_version AND u.role='employee' AND u.active=1",
    'JOIN employees e ON e.id=sess.employee_id AND e.company_id=sess.company_id',
    "AND e.status='active' AND e.deleted_at IS NULL",
    "JOIN companies co ON co.id=e.company_id AND co.status='active'",
    'JOIN employee_cpf_links l ON l.employee_id=e.id AND l.company_id=co.id',
    'JOIN company_punch_policies pol ON pol.company_id=co.id AND pol.enabled=1',
    'WHERE sess.token_hash=? AND sess.employee_id=? AND sess.company_id=?',
    'AND sess.expires_at>? AND sess.last_seen_at>?'
  ].join(' ')).bind(s.token_hash,s.employee_id,s.company_id,now,now-3600000)
    .first<Eligibility>();
  ensure(employee,409,'company_punch_disabled',
    'O registro de ponto ainda não foi liberado para esta empresa.');
  const workDate=localDate(now,employee.timezone);
  ensure(workDate>=employee.admission_date &&
    (!employee.employment_end||workDate<=employee.employment_end),
    409,'outside_employment','A data está fora do vínculo cadastrado.');
  const day=await db.prepare([
    'SELECT id,company_id,next_seq,schedule_json,rules_json,timezone',
    'FROM work_days WHERE employee_id=? AND work_date=?'
  ].join(' ')).bind(s.employee_id,workDate).first<Day>();
  ensure(!day||day.company_id===s.company_id,409,'legacy_day_pending',
    'O histórico deste dia precisa ser conciliado pelo administrador.');
  ensure(canUseFrozenCompanyWorkday(day),409,'unstarted_company_workday',
    'O dia ainda não possui marcações confirmadas. Solicite conferência ao administrador.');

  let shift:Schedule, rules:Rules;
  let activeAssignmentId:string|null=null;
  let activeScheduleConfigJson:string|null=null;
  if(day) {
    const parsed=shiftSchema.safeParse(JSON.parse(day.schedule_json));
    const r=rulesSchema.safeParse(JSON.parse(day.rules_json));
    ensure(parsed.success && r.success,409,'invalid_day_snapshot',
      'O histórico do dia precisa de conferência.');
    shift=scheduleForDate(parsed.data as Schedule,workDate);
    rules=r.data as Rules;
  } else {
    const row=await db.prepare(SELECT_ACTIVE_COMPANY_SCHEDULE_SQL)
      .bind(s.company_id,workDate,s.employee_id,workDate)
      .first<{config_json:string;assignment_id:string}>();
    ensure(row,409,'no_company_schedule',
      'Sua empresa ainda não atribuiu uma jornada.');
    activeAssignmentId=row.assignment_id;
    activeScheduleConfigJson=row.config_json;
    const parsed=shiftSchema.safeParse(JSON.parse(row.config_json));
    const r=rulesSchema.safeParse(JSON.parse(employee.rules_json));
    ensure(parsed.success && r.success,409,'invalid_company_schedule',
      'A jornada e suas regras precisam ser conferidas.');
    shift=scheduleForDate(parsed.data as Schedule,workDate);
    rules=r.data as Rules;
  }

  const minutes=scheduleMinutes(shift);
  ensure(minutes.daily>=60 && minutes.daily<=1440 &&
    minutes.pause>=0 && minutes.pause<=240 && !minutes.overnight,
    409,'unsupported_schedule','Esta jornada requer validação adicional.');
  const weekday=DateTime.fromMillis(now,{zone:employee.timezone}).weekday%7;
  ensure(shift.weekdays.includes(weekday),409,'outside_schedule',
    'Não há expediente previsto para hoje.');
  const bounds=shiftBounds(workDate,shift,employee.timezone);
  ensure(now>=bounds.start-4*3600000 && now<=bounds.end+6*3600000,
    409,'outside_punch_window','O horário está fora da janela segura de ponto.');
  return {day,employee,shift,rules,workDate,activeAssignmentId,activeScheduleConfigJson};
}

async function prior(c:Ctx,s:ActiveSession,key:string):Promise<Previous|null> {
  return c.get('db').prepare([
    'SELECT p.id,p.type,p.recorded_at,p.receipt_hash,d.work_date,d.timezone,d.company_id',
    'FROM punches p JOIN work_days d ON d.id=p.work_day_id',
    'WHERE p.employee_id=? AND p.idempotency_key=?'
  ].join(' ')).bind(s.employee_id,key).first<Previous>();
}

function replay(c:Ctx,found:Previous,type:PunchType,companyId:string) {
  ensure(found.company_id===companyId && found.type===type,
    409,'idempotency_conflict',
    'Esta chave de confirmação já foi usada em outro registro.');
  c.header('Cache-Control','private, no-store');
  return c.json({success:true,replayed:true,punch:{
    id:found.id,type,recorded_at:found.recorded_at,
    work_date:found.work_date,receipt_hash:found.receipt_hash
  }});
}

employeeCpfPunchRoutes.get('/today',async c=>{
  const s=await authorized(c,false),now=Date.now();
  const data=await loadContext(c,s,now);
  const seq=data.day?.next_seq||0;
  ensure(seq>=0&&seq<=4,409,'invalid_sequence',
    'A sequência do dia precisa ser verificada.');
  c.header('Cache-Control','private, no-store');
  return c.json({
    company_id:s.company_id,employee_id:s.employee_id,
    work_date:data.workDate,next_seq:seq,
    next_type:seq===4?null:cpfPunchTypes[seq],
    completed:seq===4,server_now:now
  });
});

employeeCpfPunchRoutes.post('/punch',async c=>{
  const s=await authorized(c,true);
  await limit(c,'cpf-punch:'+s.company_id+':'+s.employee_id,20,3600000);
  const parsed=requestSchema.safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_punch','Informe registro e confirmação UUID.');
  const {type,idempotency_key:key}=parsed.data;
  const previous=await prior(c,s,key);
  if(previous)return replay(c,previous,type,s.company_id);

  const now=Date.now(),ctx=await loadContext(c,s,now);
  const seq=ctx.day?.next_seq||0;
  ensure(seq<4&&cpfPunchTypes[seq]===type,409,'invalid_sequence',
    'A ordem das batidas mudou. Atualize a tela para conferir.');

  const db=c.get('db'),punchId=crypto.randomUUID();
  const receipt=sha256(JSON.stringify({
    punchId,companyId:s.company_id,employeeId:s.employee_id,
    workDate:ctx.workDate,type,recordedAt:now
  }));
  const insertDay=db.prepare([
    'INSERT INTO work_days(',
    'id,employee_id,work_date,timezone,schedule_json,rules_json,',
    'next_seq,created_at,company_id)',
    'SELECT ?,e.id,?,?,?,?,0,?,co.id',
    'FROM employee_company_sessions sess',
    'JOIN users u ON u.id=sess.user_id AND u.employee_id=sess.employee_id',
    "AND u.auth_version=sess.auth_version AND u.active=1 AND u.role='employee'",
    'JOIN employees e ON e.id=sess.employee_id AND e.company_id=sess.company_id',
    "AND e.status='active' AND e.deleted_at IS NULL",
    "JOIN companies co ON co.id=e.company_id AND co.status='active'",
    'JOIN employee_cpf_links l ON l.employee_id=e.id AND l.company_id=co.id',
    'JOIN company_punch_policies pol ON pol.company_id=co.id AND pol.enabled=1',
    'WHERE sess.token_hash=? AND sess.employee_id=? AND sess.company_id=?',
    'AND sess.expires_at>? AND sess.last_seen_at>?',
    'AND NOT EXISTS (SELECT 1 FROM work_days existing',
    'WHERE existing.employee_id=e.id AND existing.work_date=?)',
    'ON CONFLICT(employee_id,work_date) DO NOTHING'
  ].join(' ')).bind(
    ctx.day?.id||crypto.randomUUID(),ctx.workDate,ctx.employee.timezone,
    JSON.stringify(ctx.shift),JSON.stringify(ctx.rules),now,
    s.token_hash,s.employee_id,s.company_id,now,now-3600000,ctx.workDate
  );
  // Subconsulta escalar deve encontrar exatamente o dia da empresa
  // E uma sessao valida. Caso nao encontre, work_day_id NULL falha e
  // reverte o batch D1 em vez de gerar registro orfao.
  const insertPunch=db.prepare([
    'INSERT INTO punches(',
    'id,work_day_id,employee_id,seq,type,recorded_at,',
    'idempotency_key,ip_hash,receipt_hash)',
    'VALUES (?,(',
    'SELECT d.id FROM work_days d',
    'JOIN employee_company_sessions sess',
    'ON sess.employee_id=d.employee_id AND sess.company_id=d.company_id',
    'JOIN users u ON u.id=sess.user_id AND u.employee_id=sess.employee_id',
    'AND u.auth_version=sess.auth_version AND u.active=1',
    'JOIN employees e ON e.id=d.employee_id AND e.company_id=d.company_id',
    "AND e.status='active' AND e.deleted_at IS NULL",
    "JOIN companies co ON co.id=d.company_id AND co.status='active'",
    'JOIN employee_cpf_links l ON l.employee_id=d.employee_id',
    'AND l.company_id=d.company_id',
    'JOIN company_punch_policies pol ON pol.company_id=d.company_id',
    'AND pol.enabled=1',
    'WHERE d.employee_id=? AND d.company_id=? AND d.work_date=?',
    'AND sess.token_hash=? AND sess.expires_at>? AND sess.last_seen_at>?',
    'AND d.next_seq=?',
    'AND (?=1 OR (',
    '? = (' + CURRENT_ACTIVE_ASSIGNMENT_ID_SQL + ')',
    'AND ? = (' + CURRENT_ASSIGNMENT_CONFIG_SQL + ')',
    'AND ? = pol.rules_json',
    '))',
    '),?,?,?,?,?,?,?)'
  ].join(' ')).bind(
    punchId,s.employee_id,s.company_id,ctx.workDate,
    s.token_hash,now,now-3600000,seq,
    ctx.day?1:0,ctx.activeAssignmentId,ctx.workDate,
    ctx.activeScheduleConfigJson,ctx.workDate,ctx.activeAssignmentId,ctx.employee.rules_json,
    s.employee_id,seq,type,now,key,ipHash(c),receipt
  );

  try {
    const r=await db.batch([insertDay,insertPunch]);
    ensure(r[1].meta.changes===1,409,'punch_not_confirmed',
      'O registro não foi confirmado.');
  } catch(err) {
    const confirmed=await prior(c,s,key);
    if(confirmed)return replay(c,confirmed,type,s.company_id);
    if(err instanceof ApiError)throw err;
    throw new ApiError(409,'punch_conflict',
      'Não foi possível confirmar o ponto. Atualize a tela e confira.');
  }
  c.header('Cache-Control','private, no-store');
  return c.json({success:true,replayed:false,punch:{
    id:punchId,type,recorded_at:now,
    work_date:ctx.workDate,receipt_hash:receipt
  }},201);
});
