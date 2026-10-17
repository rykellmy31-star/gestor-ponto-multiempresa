
import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';

import type { App, Ctx } from '../types';
import { auth, limit } from '../core/security';
import { body, month, parse } from '../core/validation';
import { ensure } from '../core/errors';
import { localDate } from '../core/time';

const moodSchema = z.enum([
  'very_happy',
  'good',
  'neutral',
  'sad',
  'stressed'
]);

export const employeeMoodRoutes = new Hono<App>();
export const adminMoodRoutes = new Hono<App>();

employeeMoodRoutes.use('*', auth('employee'));
adminMoodRoutes.use('*', auth('admin'));

async function moodContext(c: Ctx) {
  const db = c.get('db');
  const employeeId = c.get('principal').employee_id!;

  const settings = await db.prepare(
    'SELECT timezone FROM settings WHERE id = 1'
  ).first<{ timezone: string }>();

  ensure(
    settings,
    503,
    'settings_unavailable',
    'Configuracoes indisponiveis.'
  );

  const now = Date.now();
  const today = localDate(now, settings.timezone);

  // Aceita a entrada recente, inclusive em jornada noturna.
  const entry = await db.prepare(`
    SELECT d.work_date AS mood_date
    FROM punches p
    JOIN work_days d ON d.id = p.work_day_id
    WHERE p.employee_id = ?
      AND p.type = 'entry'
      AND p.recorded_at >= ?
    ORDER BY p.recorded_at DESC
    LIMIT 1
  `).bind(
    employeeId,
    now - 24 * 60 * 60 * 1000
  ).first<{ mood_date: string }>();

  const moodDate = entry?.mood_date ?? today;

  return {
    db,
    employeeId,
    moodDate,
    eligible: !!entry
  };
}

// Consulta se a pergunta pode ser exibida.
employeeMoodRoutes.get('/mood/today', async c => {
  const ctx = await moodContext(c);

  const saved = await ctx.db.prepare(`
    SELECT mood
    FROM employee_moods
    WHERE employee_id = ?
      AND mood_date = ?
  `).bind(
    ctx.employeeId,
    ctx.moodDate
  ).first<{ mood: string }>();

  return c.json({
    date: ctx.moodDate,
    eligible: ctx.eligible,
    answered: !!saved,
    mood: saved?.mood ?? null
  });
});

// Registra a resposta voluntaria do funcionario.
employeeMoodRoutes.post('/mood', async c => {
  const input = await body(
    c,
    z.object({
      mood: moodSchema
    }).strict()
  );

  const ctx = await moodContext(c);

  ensure(
    ctx.eligible,
    409,
    'entry_required',
    'Registre sua entrada antes de responder.'
  );

  await limit(
    c,
    `employee-mood:${ctx.employeeId}`,
    10,
    60 * 60 * 1000
  );

  const id = crypto.randomUUID();

  await ctx.db.prepare(`
    INSERT INTO employee_moods (
      id,
      employee_id,
      mood_date,
      mood,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, mood_date)
    DO NOTHING
  `).bind(
    id,
    ctx.employeeId,
    ctx.moodDate,
    input.mood,
    Date.now()
  ).run();

  const saved = await ctx.db.prepare(`
    SELECT mood
    FROM employee_moods
    WHERE employee_id = ?
      AND mood_date = ?
  `).bind(
    ctx.employeeId,
    ctx.moodDate
  ).first<{ mood: string }>();

  return c.json({
    message: 'Resposta registrada. Obrigado!',
    date: ctx.moodDate,
    mood: saved?.mood,
    already_answered: saved?.mood !== input.mood
  });
});

// Relatorio mensal exclusivo do administrador.
adminMoodRoutes.get('/mood', async c => {
  const selectedMonth = parse(
    month,
    c.req.query('month') ??
      DateTime.now()
        .setZone('America/Bahia')
        .toFormat('yyyy-MM')
  );

  const from = `${selectedMonth}-01`;

  const until = DateTime.fromISO(from)
    .plus({ months: 1 })
    .toISODate()!;

  const rows = await c.get('db').prepare(`
    SELECT
      m.employee_id,
      e.full_name AS employee_name,
      m.mood_date,
      m.mood
    FROM employee_moods m
    JOIN employees e
      ON e.id = m.employee_id
    WHERE e.deleted_at IS NULL
      AND m.mood_date >= ?
      AND m.mood_date < ?
    ORDER BY
      m.mood_date DESC,
      e.full_name ASC
  `).bind(from, until).all<{
    employee_id: string;
    employee_name: string;
    mood_date: string;
    mood: string;
  }>();

  const totals: Record<string, number> = {
    very_happy: 0,
    good: 0,
    neutral: 0,
    sad: 0,
    stressed: 0
  };

  for (const row of rows.results) {
    if (row.mood in totals) {
      totals[row.mood] += 1;
    }
  }

  return c.json({
    month: selectedMonth,
    totals,
    responses: rows.results,
    total_responses: rows.results.length
  });
});
