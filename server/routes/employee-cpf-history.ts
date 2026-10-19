import { Hono } from 'hono';
import type { App } from '../types';
import { ensure } from '../core/errors';
import { getEmployeeCpfSession } from './employee-cpf-auth';

export const employeeCpfHistoryRoutes = new Hono<App>();

type PointHistoryRow = {
  work_date: string;
  next_seq: number;
  punch_id: string | null;
  seq: number | null;
  type: 'entry' | 'break_start' | 'break_end' | 'exit' | null;
  recorded_at: number | null;
};

function periodBounds(value: string | undefined): [string, string] | null {
  if (!value || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return [value + '-01', String(nextYear) + '-' +
    String(nextMonth).padStart(2, '0') + '-01'];
}

// Consulta somente leitura. Nunca recebe employee_id ou company_id
// da URL: ambos sao obtidos da sessao CPF/empresa autenticada.
employeeCpfHistoryRoutes.get('/history', async c => {
  const session = await getEmployeeCpfSession(c);
  ensure(session, 401, 'unauthenticated', 'Entre para consultar seu ponto.');
  ensure(!session.must_change_password, 403,
    'password_change_required', 'Altere sua senha inicial antes de continuar.');

  const period = periodBounds(c.req.query('month'));
  ensure(period, 400, 'invalid_month', 'Informe o mês no formato AAAA-MM.');

  const now = Date.now();
  const result = await c.get('db').prepare(`
    SELECT
      d.work_date, d.next_seq,
      p.id AS punch_id, p.seq, p.type, p.recorded_at
    FROM employee_company_sessions s
    JOIN users u ON u.id = s.user_id
      AND u.employee_id = s.employee_id
      AND u.auth_version = s.auth_version
      AND u.active = 1 AND u.role = 'employee'
    JOIN employees e ON e.id = s.employee_id
      AND e.company_id = s.company_id
      AND e.deleted_at IS NULL AND e.status = 'active'
    JOIN companies co ON co.id = s.company_id
      AND co.status = 'active'
    JOIN employee_cpf_links l ON l.employee_id = e.id
      AND l.company_id = co.id
    JOIN work_days d ON d.employee_id = e.id
    LEFT JOIN punches p ON p.work_day_id = d.id
      AND p.employee_id = e.id
    WHERE s.token_hash = ?
      AND s.expires_at > ? AND s.last_seen_at > ?
      AND e.id = ? AND e.company_id = ?
      AND d.work_date >= ? AND d.work_date < ?
    ORDER BY d.work_date ASC, p.seq ASC
    LIMIT 150
  `).bind(
    session.token_hash, now, now - 60 * 60000,
    session.employee_id, session.company_id,
    period[0], period[1]
  ).all<PointHistoryRow>();

  const days = new Map<string, {
    date: string;
    next_seq: number;
    punches: Array<{ id: string; seq: number; type: string; recorded_at: number }>;
  }>();
  for (const row of result.results || []) {
    let day = days.get(row.work_date);
    if (!day) {
      day = { date: row.work_date, next_seq: row.next_seq, punches: [] };
      days.set(row.work_date, day);
    }
    if (row.punch_id !== null &&
        row.seq !== null &&
        row.type !== null &&
        row.recorded_at !== null) {
      day.punches.push({
        id: row.punch_id,
        seq: row.seq,
        type: row.type,
        recorded_at: row.recorded_at
      });
    }
  }

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    success: true,
    company_id: session.company_id,
    employee_id: session.employee_id,
    month: c.req.query('month'),
    days: [...days.values()]
  });
});
