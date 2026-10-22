import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App, Schedule } from '../types';
import { ensure, ApiError } from '../core/errors';
import { sha256 } from '../core/crypto';
import { limit } from '../core/security';
import { scheduleMinutes, scheduleForDate } from '../core/time';
import { SELECT_ACTIVE_COMPANY_SCHEDULE_SQL } from '../core/active-company-schedule';
import { scheduleSchema as validatedSchedule, dayOverridesSchema } from '../core/validation';
import { requireCompanyAdmin } from './company-auth';
import { VALID_COMPANY_ADMIN_WRITE_SQL, companyAdminWriteParams } from '../core/company-admin-write-guard';

export const companySchedulesRoutes = new Hono<App>();
companySchedulesRoutes.use('*', requireCompanyAdmin);

// Configuracao empresarial desativada por padrao ate migracao 0019
// e testes locais/staging. Nenhum segredo armazenado no repositorio.
companySchedulesRoutes.use('*', async (c, next) => {
  ensure(c.env.ENABLE_COMPANY_SCHEDULES === 'true', 503,
    'company_schedules_unavailable', 'Jornadas empresariais ainda indisponíveis.');
  await next();
});

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleSchema = z.object({
  name: z.string().trim().min(3).max(100),
  start: clock,
  break_start: clock,
  break_end: clock,
  end: clock,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine(days => new Set(days).size === days.length),
  paid_break: z.boolean(),
  day_overrides: dayOverridesSchema.optional()
}).strict();

const assignmentSchema = z.object({
  employee_id: z.string().trim().min(1).max(128),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();

function validSchedule(config: Schedule): boolean {
  if (!validatedSchedule.safeParse(config).success) return false;
  const minutes = scheduleMinutes(config);
  return minutes.weekly >= 60 && minutes.weekly <= 7*1440;
}

companySchedulesRoutes.get('/', async c => {
  const company = c.get('company');
  ensure(company, 401, 'unauthenticated', 'Empresa não autenticada.');
  const result = await c.get('db').prepare([
    'SELECT s.id,s.name,s.config_json,s.created_at',
    'FROM schedules s JOIN companies c ON c.id=s.company_id',
    'WHERE s.company_id=? AND c.status=\'active\' AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM company_workspace_audit wa WHERE wa.company_id=s.company_id AND wa.target_id=s.id)',
    'ORDER BY s.created_at DESC,s.id DESC LIMIT 100'
  ].join(' ')).bind(company.id).all<{
    id: string; name: string; config_json: string; created_at: number;
  }>();

  return c.json({
    company_id: company.id,
    schedules: (result.results || []).map(row => ({
      id: row.id, name: row.name,
      config: JSON.parse(row.config_json) as Schedule,
      created_at: row.created_at
    }))
  });
});

companySchedulesRoutes.post('/', async c => {
  const company = c.get('company'), adminId = c.get('companyAdminId');
  const adminToken = c.get('companyAdminTokenHash');
  ensure(company && adminId && adminToken, 401, 'unauthenticated', 'Empresa não autenticada.');
  await limit(c, 'company-schedule-create:' + company.id + ':' + adminId,
    30, 60 * 60000);
  const parsed = scheduleSchema.safeParse(
    await c.req.json().catch(() => null)
  );
  ensure(parsed.success, 400, 'invalid_schedule',
    'Confira os horários e dias de trabalho.');
  const { name, ...config } = parsed.data;
  ensure(validSchedule(config), 422, 'invalid_schedule',
    'Jornada ou intervalo inválidos.');

  // Clientes legados sem chave continuam suportados. A interface nova envia
  // o mesmo UUID ao repetir uma tentativa cujo resultado nao chegou.
  const rawKey = c.req.header('Idempotency-Key');
  ensure(rawKey === undefined ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawKey),
    400, 'invalid_idempotency_key', 'Identificador da tentativa inválido.');
  const requestKey = rawKey?.toLowerCase() ?? null;
  const fingerprint = sha256(JSON.stringify({ name, ...config }));
  const db = c.get('db');
  const lookup = () => db.prepare(`
    SELECT request_fingerprint,schedule_id FROM company_schedule_create_requests
    WHERE company_id=? AND admin_id=? AND request_key=?
  `).bind(company.id,adminId,requestKey).first<{
    request_fingerprint:string;schedule_id:string
  }>();
  const replay = async () => {
    const recorded = await lookup();
    ensure(recorded,409,'schedule_create_conflict',
      'Não foi possível confirmar o cadastro. Consulte a lista de escalas.');
    ensure(recorded.request_fingerprint === fingerprint,409,
      'idempotency_key_reused','Esta tentativa pertence a uma escala diferente.');
    return c.json({success:true,id:recorded.schedule_id,
      company_id:company.id,reused:true},200);
  };
  if (requestKey && await lookup()) return replay();

  const id = crypto.randomUUID(), now = Date.now();
  const insert = [
    'INSERT INTO schedules(id,name,config_json,created_by,created_at,company_id)',
    'SELECT ?,?,?,NULL,?,c.id FROM companies c',
    'WHERE c.id=? AND c.status=\'active\'',
    'AND ' + VALID_COMPANY_ADMIN_WRITE_SQL
  ];
  if (requestKey) insert.push(
    'AND NOT EXISTS (SELECT 1 FROM company_schedule_create_requests r',
    'WHERE r.company_id=c.id AND r.admin_id=? AND r.request_key=?)'
  );
  const statements = [
    db.prepare(insert.join(' ')).bind(id,name,JSON.stringify(config),now,company.id,
      ...companyAdminWriteParams(adminToken,adminId,company.id,now),
      ...(requestKey ? [adminId,requestKey] : [])),
    db.prepare([
      'INSERT INTO company_schedule_audit(',
      'id,company_id,admin_id,action,schedule_id,employee_id,details_json,created_at)',
      'SELECT ?,?,?,\'created\',?,NULL,?,?',
      'WHERE EXISTS(SELECT 1 FROM schedules WHERE id=? AND company_id=?)'
    ].join(' ')).bind(crypto.randomUUID(),company.id,adminId,id,
      JSON.stringify({name}),now,id,company.id)
  ];
  if (requestKey) statements.push(db.prepare(`
    INSERT INTO company_schedule_create_requests
      (company_id,admin_id,request_key,request_fingerprint,schedule_id,created_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM schedules WHERE id=? AND company_id=?)
  `).bind(company.id,adminId,requestKey,fingerprint,id,now,id,company.id));
  // D1.batch executa as instrucões atomicamente: cadastro, auditoria e chave.
  const result = await db.batch(statements);
  if (requestKey && result[0].meta.changes === 0) return replay();
  // O SELECT acima usa a chave primaria da empresa: insere no maximo uma
  // jornada. D1.meta.changes inclui os triggers de historico/revisao, logo
  // um INSERT confirmado pode reportar mais de uma alteracao. Zero continua
  // indicando sessao revogada/inatividade/replay; auditoria e chave exigem 1.
  ensure(result[0].meta.changes >= 1 && result[1].meta.changes === 1 &&
    (!requestKey || result[2].meta.changes === 1),
    409, 'company_inactive', 'Empresa inativa ou cadastro alterado.');
  return c.json({ success: true, id, company_id: company.id }, 201);
});

// Read-only preview: shows exactly which active assignment the employee
// would use on each date. No punches or schedules are modified.
companySchedulesRoutes.get('/employee/:id/week', async c => {
  const company=c.get('company');
  ensure(company,401,'unauthenticated','Empresa não autenticada.');
  const from=c.req.query('from')??'';
  const first=DateTime.fromISO(from,{zone:'utc'});
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(from) && first.isValid &&
    first.toISODate()===from && from>='1900-01-01' && from<='2100-12-24',
    400,'invalid_date','Selecione uma data válida.');
  const db=c.get('db'), employeeId=c.req.param('id');
  const employee=await db.prepare([
    'SELECT id,full_name FROM employees',
    'WHERE id=? AND company_id=? AND deleted_at IS NULL'
  ].join(' ')).bind(employeeId,company.id)
    .first<{id:string;full_name:string}>();
  ensure(employee,404,'employee_not_found',
    'Funcionário não encontrado nesta empresa.');
  const dates=Array.from({length:7},(_,i)=>first.plus({days:i}).toISODate()!);
  const days=await Promise.all(dates.map(async date=>{
    const row=await db.prepare(SELECT_ACTIVE_COMPANY_SCHEDULE_SQL.replace('a.id AS assignment_id','a.id AS assignment_id,s.id AS schedule_id,s.name AS schedule_name'))
      .bind(company.id,date,employeeId,date)
      .first<{config_json:string;assignment_id:string;schedule_id:string;schedule_name:string}>();
    if(!row) return {date,assignment_id:null,shift:null};
    const parsed=validatedSchedule.safeParse(JSON.parse(row.config_json));
    ensure(parsed.success,409,'invalid_company_schedule',
      'A jornada cadastrada precisa de conferência.');
    const weekday=DateTime.fromISO(date,{zone:'utc'}).weekday%7;
    return {
      date,assignment_id:row.assignment_id,schedule_id:row.schedule_id,schedule_name:row.schedule_name,
      shift:parsed.data.weekdays.includes(weekday)
        ? scheduleForDate(parsed.data,date) : null
    };
  }));
  c.header('Cache-Control','private, no-store');
  return c.json({
    success:true,company_id:company.id,employee_id:employee.id,
    employee_name:employee.full_name,from,days
  });
});

// Atribuição em lote: o gestor escolhe um modelo para todos os funcionários
// ativos da empresa. Um conflito ou uma sessão revogada aborta o lote inteiro.
// Repetir o mesmo lote/data é seguro: atribuições iguais são reutilizadas.
companySchedulesRoutes.post('/:id/assign-all', async c => {
  const company=c.get('company'), adminId=c.get('companyAdminId');
  const adminToken=c.get('companyAdminTokenHash');
  ensure(company&&adminId&&adminToken,401,'unauthenticated','Entre novamente.');
  await limit(c,'company-schedule-assign-all:'+company.id+':'+adminId,12,3600000);
  const parsed=z.object({
    effective_from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }).strict().safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_assignment','Informe a data de início.');
  const effective_from=parsed.data.effective_from;
  const date=DateTime.fromISO(effective_from,{zone:'utc'});
  ensure(date.isValid&&date.toISODate()===effective_from&&
    effective_from>='1900-01-01'&&effective_from<='2100-12-31',
    400,'invalid_assignment','Data inválida.');
  const db=c.get('db'), scheduleId=c.req.param('id'),now=Date.now();
  const schedule=await db.prepare([
    'SELECT s.id FROM schedules s JOIN companies co ON co.id=s.company_id',
    'WHERE s.id=? AND s.company_id=? AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM company_workspace_audit wa WHERE wa.company_id=s.company_id AND wa.target_id=s.id)',
    "AND co.status='active'"
  ].join(' ')).bind(scheduleId,company.id).first<{id:string}>();
  ensure(schedule,404,'schedule_not_found','Jornada não encontrada nesta empresa.');
  const rows=await db.prepare([
    'SELECT e.id, (SELECT a.schedule_id FROM schedule_assignments a',
    'WHERE a.employee_id=e.id AND a.effective_from=?',
    'AND NOT EXISTS (SELECT 1 FROM schedule_assignment_cancellations cac',
    'WHERE cac.assignment_id=a.id)',
    'ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS existing_schedule_id',
    'FROM employees e JOIN companies co ON co.id=e.company_id',
    "AND co.status='active'",
    "WHERE e.company_id=? AND e.status='active' AND e.deleted_at IS NULL",
    'ORDER BY e.id LIMIT 201'
  ].join(' ')).bind(effective_from,company.id)
    .all<{id:string;existing_schedule_id:string|null}>();
  const employees=rows.results||[];
  ensure(employees.length>0,409,'no_active_employees',
    'Não há funcionários ativos nesta empresa.');
  ensure(employees.length<=200,409,'bulk_assignment_limit',
    'Há mais de 200 funcionários ativos. Divida a atribuição em grupos.');
  ensure(!employees.some(e=>e.existing_schedule_id&&
    e.existing_schedule_id!==scheduleId),
    409,'schedule_date_conflict',
    'Um ou mais funcionários já têm outra jornada ativa nesta data. Nenhuma alteração foi feita.');
  const pending=employees.filter(e=>e.existing_schedule_id!==scheduleId);
  if(!pending.length) return c.json({
    success:true,company_id:company.id,assigned_count:0,
    reused_count:employees.length,reused:true
  },200);

  const statements:D1PreparedStatement[]=[];
  for(const employee of pending){
    const assignmentId=crypto.randomUUID(),guardId=crypto.randomUUID();
    statements.push(
      db.prepare([
        'INSERT INTO schedule_assignments(',
        'id,employee_id,schedule_id,effective_from,created_at)',
        'SELECT ?,e.id,s.id,?,? FROM employees e',
        'JOIN schedules s ON s.id=? AND s.company_id=e.company_id',
        'AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM company_workspace_audit wa WHERE wa.company_id=s.company_id AND wa.target_id=s.id)',
        'JOIN companies co ON co.id=e.company_id',
        'WHERE e.id=? AND e.company_id=?',
        "AND e.deleted_at IS NULL AND e.status='active'",
        "AND co.status='active'",
        'AND NOT EXISTS (SELECT 1 FROM schedule_assignments existing',
        'WHERE existing.employee_id=e.id AND existing.effective_from=?',
        'AND NOT EXISTS (SELECT 1 FROM schedule_assignment_cancellations cac',
        'WHERE cac.assignment_id=existing.id))',
        'AND '+VALID_COMPANY_ADMIN_WRITE_SQL
      ].join(' ')).bind(assignmentId,effective_from,now,scheduleId,
        employee.id,company.id,effective_from,
        ...companyAdminWriteParams(adminToken,adminId,company.id,now)),
      // Existing migration 0031 requires changes()=1. Any missing row
      // aborts D1.batch and rolls back ALL inserts and audit events.
      db.prepare('INSERT INTO company_employee_write_guards(id,affected_rows) VALUES (?,changes())')
        .bind(guardId),
      db.prepare('DELETE FROM company_employee_write_guards WHERE id=?')
        .bind(guardId),
      db.prepare([
        'INSERT INTO company_schedule_audit(',
        'id,company_id,admin_id,action,schedule_id,employee_id,details_json,created_at)',
        "SELECT ?,?,?,'assigned',?,?,?,?",
        'WHERE EXISTS(SELECT 1 FROM schedule_assignments a',
        'JOIN employees e ON e.id=a.employee_id',
        'WHERE a.id=? AND e.company_id=?)'
      ].join(' ')).bind(crypto.randomUUID(),company.id,adminId,scheduleId,
        employee.id,JSON.stringify({effective_from,bulk:true}),now,
        assignmentId,company.id)
    );
  }
  try{
    await db.batch(statements);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(message.includes('company_employee_write_conflict')||
      message.includes('schedule_date_conflict')){
      throw new ApiError(409,'bulk_assignment_conflict',
        'A escala ou a sessão mudou durante a atribuição. Nenhum funcionário foi alterado.');
    }
    throw error;
  }
  return c.json({
    success:true,company_id:company.id,assigned_count:pending.length,
    reused_count:employees.length-pending.length,reused:false
  },201);
});

companySchedulesRoutes.post('/:id/assign', async c => {
  const company = c.get('company'), adminId = c.get('companyAdminId');
  const adminToken = c.get('companyAdminTokenHash');
  ensure(company && adminId && adminToken, 401, 'unauthenticated', 'Empresa não autenticada.');
  await limit(c, 'company-schedule-assign:' + company.id + ':' + adminId,
    60, 60 * 60000);

  const parsed = assignmentSchema.safeParse(
    await c.req.json().catch(() => null)
  );
  ensure(parsed.success, 400, 'invalid_assignment',
    'Informe funcionário e data válidos.');
  const { employee_id, effective_from } = parsed.data;
  const date = DateTime.fromISO(effective_from, { zone: 'utc' });
  ensure(date.isValid && date.toISODate() === effective_from &&
    effective_from >= '1900-01-01' && effective_from <= '2100-12-31',
    400, 'invalid_assignment', 'Data inválida.');

  const db = c.get('db'), id = c.req.param('id');
  const assignmentId = crypto.randomUUID(), now = Date.now();
  const result = await db.batch([
    db.prepare([
      'INSERT INTO schedule_assignments(',
      'id,employee_id,schedule_id,effective_from,created_at)',
      'SELECT ?,e.id,s.id,?,? FROM employees e',
      'JOIN schedules s ON s.id=? AND s.company_id=e.company_id AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM company_workspace_audit wa WHERE wa.company_id=s.company_id AND wa.target_id=s.id)',
      'JOIN companies co ON co.id=e.company_id',
      'WHERE e.id=? AND e.company_id=?',
      'AND e.deleted_at IS NULL AND e.status=\'active\'',
      'AND co.status=\'active\'',
      'AND NOT EXISTS (SELECT 1 FROM schedule_assignments existing',
      'WHERE existing.employee_id=e.id AND existing.effective_from=?',
      'AND NOT EXISTS (SELECT 1 FROM schedule_assignment_cancellations cancelled',
      'WHERE cancelled.assignment_id=existing.id))',
      'AND ' + VALID_COMPANY_ADMIN_WRITE_SQL
    ].join(' ')).bind(assignmentId, effective_from, now, id,
      employee_id, company.id, effective_from,
      ...companyAdminWriteParams(adminToken,adminId,company.id,now)),
    db.prepare([
      'INSERT INTO company_schedule_audit(',
      'id,company_id,admin_id,action,schedule_id,employee_id,details_json,created_at)',
      'SELECT ?,?,?,\'assigned\',?,?,?,?',
      'WHERE EXISTS(SELECT 1 FROM schedule_assignments a',
      'JOIN employees e ON e.id=a.employee_id',
      'WHERE a.id=? AND e.company_id=?)'
    ].join(' ')).bind(crypto.randomUUID(), company.id, adminId,
      id, employee_id, JSON.stringify({ effective_from }), now,
      assignmentId, company.id)
  ]);

  // Repeating a request after a lost response must not create a new
  // assignment or another audit entry. A different active schedule on the
  // same date remains a conflict. Cancelled assignments may be replaced.
  if (result[0].meta.changes === 0) {
    const existing = await db.prepare([
      'SELECT a.id,a.schedule_id FROM schedule_assignments a',
      'JOIN employees e ON e.id=a.employee_id',
      'JOIN companies co ON co.id=e.company_id AND co.status=\'active\'',
      'JOIN schedules s ON s.id=a.schedule_id',
      'AND s.company_id=e.company_id AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM company_workspace_audit wa WHERE wa.company_id=s.company_id AND wa.target_id=s.id)',
      'WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL',
      'AND e.status=\'active\' AND a.effective_from=?',
      'AND NOT EXISTS (SELECT 1 FROM schedule_assignment_cancellations cancelled',
      'WHERE cancelled.assignment_id=a.id)',
      'ORDER BY a.created_at DESC,a.id DESC LIMIT 1'
    ].join(' ')).bind(employee_id, company.id, effective_from)
      .first<{ id:string; schedule_id:string }>();
    if (existing) {
      ensure(existing.schedule_id === id, 409, 'schedule_date_conflict',
        'Já existe outra jornada ativa nessa data para o funcionário.');
      return c.json({ success:true, company_id:company.id, reused:true }, 200);
    }
  }
  // A identidade unica do funcionario limita este INSERT a uma linha;
  // o trigger de revisao tambem entra em meta.changes no schema completo.
  ensure(result[0].meta.changes >= 1 && result[1].meta.changes === 1,
    404, 'invalid_company_assignment',
    'Funcionário ou jornada não pertence à empresa.');
  return c.json({ success: true, company_id: company.id }, 201);
});

// Remove a template from the catalogue without rewriting assignments or frozen days.
companySchedulesRoutes.delete('/:id',async c=>{
 const co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
 await limit(c,'company-schedule-archive:'+co.id+':'+admin,20,3600000);
 const db=c.get('db'),now=Date.now(),id=c.req.param('id');
 const {companyAdminWrite}=await import('../core/company-admin-write');
 await companyAdminWrite(db,[
  db.prepare(`INSERT INTO company_workspace_audit(id,company_id,admin_id,action,target_id,created_at)
   SELECT ?,company_id,?,'schedule.archived',id,? FROM schedules WHERE id=? AND company_id=? AND deleted_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM company_workspace_audit wa WHERE wa.company_id=schedules.company_id AND wa.target_id=schedules.id)
   AND EXISTS(SELECT 1 FROM companies WHERE id=? AND status='active') AND ${VALID_COMPANY_ADMIN_WRITE_SQL}`)
   .bind(crypto.randomUUID(),admin,now,id,co.id,co.id,...companyAdminWriteParams(token,admin,co.id,now))
 ],'schedule_archive_conflict');
 return c.json({success:true,company_id:co.id,id});
});
