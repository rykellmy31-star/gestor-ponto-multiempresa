import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App, Schedule } from '../types';
import { ensure } from '../core/errors';
import { sha256 } from '../core/crypto';
import { limit } from '../core/security';
import { scheduleMinutes } from '../core/time';
import { scheduleSchema as validatedSchedule, dayOverridesSchema } from '../core/validation';
import { requireCompanyAdmin } from './company-auth';

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
    'WHERE s.company_id=? AND c.status=\'active\'',
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
  ensure(company && adminId, 401, 'unauthenticated', 'Empresa não autenticada.');
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
    'WHERE c.id=? AND c.status=\'active\''
  ];
  if (requestKey) insert.push(
    'AND NOT EXISTS (SELECT 1 FROM company_schedule_create_requests r',
    'WHERE r.company_id=c.id AND r.admin_id=? AND r.request_key=?)'
  );
  const statements = [
    db.prepare(insert.join(' ')).bind(id,name,JSON.stringify(config),now,company.id,
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
  ensure(result[0].meta.changes === 1 && result[1].meta.changes === 1 &&
    (!requestKey || result[2].meta.changes === 1),
    409, 'company_inactive', 'Empresa inativa ou cadastro alterado.');
  return c.json({ success: true, id, company_id: company.id }, 201);
});

companySchedulesRoutes.post('/:id/assign', async c => {
  const company = c.get('company'), adminId = c.get('companyAdminId');
  ensure(company && adminId, 401, 'unauthenticated', 'Empresa não autenticada.');
  await limit(c, 'company-schedule-assign:' + company.id + ':' + adminId,
    60, 60 * 60000);

  const parsed = assignmentSchema.safeParse(
    await c.req.json().catch(() => null)
  );
  ensure(parsed.success, 400, 'invalid_assignment',
    'Informe funcionário e data válidos.');
  const { employee_id, effective_from } = parsed.data;
  const date = DateTime.fromISO(effective_from, { zone: 'utc' });
  ensure(date.isValid && date.toISODate() === effective_from,
    400, 'invalid_assignment', 'Data inválida.');

  const db = c.get('db'), id = c.req.param('id');
  const assignmentId = crypto.randomUUID(), now = Date.now();
  const result = await db.batch([
    db.prepare([
      'INSERT INTO schedule_assignments(',
      'id,employee_id,schedule_id,effective_from,created_at)',
      'SELECT ?,e.id,s.id,?,? FROM employees e',
      'JOIN schedules s ON s.id=? AND s.company_id=e.company_id',
      'JOIN companies co ON co.id=e.company_id',
      'WHERE e.id=? AND e.company_id=?',
      'AND e.deleted_at IS NULL AND e.status=\'active\'',
      'AND co.status=\'active\''
    ].join(' ')).bind(assignmentId, effective_from, now, id,
      employee_id, company.id),
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

  ensure(result[0].meta.changes === 1 && result[1].meta.changes === 1,
    404, 'invalid_company_assignment',
    'Funcionário ou jornada não pertence à empresa.');
  return c.json({ success: true, company_id: company.id }, 201);
});
