
import { DateTime } from 'luxon';
import type {
  Ctx,
  Employee,
  Occurrence,
  Report,
  Rules,
  Schedule
} from '../types';
import { ensure } from './errors';
import { sha256 } from './crypto';
import {
  calculateDay,
  DEFAULT_RULES,
  sumDays
} from './calculations';
import { datesBetween } from './time';

export async function reportsForMonth(
  c: Ctx,
  month: string,
  employeeId?: string,
  ignoreClosure = false
): Promise<Report[]> {
  const db = c.get('db');
  const from = `${month}-01`;
  const to = DateTime.fromISO(from)
    .endOf('month')
    .toISODate()!;
  const now = Date.now();

  const filter = employeeId
    ? ' AND employee_id=?'
    : '';

  const dayFilter = employeeId
    ? ' AND d.employee_id=?'
    : '';

  const args = (base: unknown[]) =>
    employeeId ? [...base, employeeId] : base;

  const statements = [
    db.prepare(
      'SELECT value FROM data_revision WHERE id=1'
    ),

    db.prepare(
      'SELECT company_name,company_document,timezone FROM settings WHERE id=1'
    ),

    db.prepare(`
      SELECT
        id,
        full_name,
        registration,
        job_title,
        admission_date,
        employment_end,
        status
      FROM employees
      ${employeeId ? 'WHERE id=?' : ''}
      ORDER BY full_name
    `).bind(...(employeeId ? [employeeId] : [])),

    db.prepare(`
      SELECT
        a.employee_id,
        a.schedule_id,
        a.effective_from,
        s.config_json,
        s.name
      FROM schedule_assignments a
      JOIN schedules s ON s.id = a.schedule_id
      WHERE a.effective_from <= ?
        AND NOT EXISTS (
          SELECT 1
          FROM schedule_assignment_cancellations cac
          WHERE cac.assignment_id = a.id
        )
        ${employeeId ? 'AND a.employee_id=?' : ''}
      ORDER BY a.effective_from, a.created_at
    `).bind(...args([to])),

    // Historico de alteracoes das jornadas.
    db.prepare(`
      SELECT
        id,
        schedule_id,
        effective_from,
        name,
        config_json
      FROM schedule_history
      WHERE effective_from <= ?
      ORDER BY effective_from ASC, id ASC
    `).bind(to),

    db.prepare(`
      SELECT effective_from,config_json
      FROM rule_versions
      WHERE effective_from<=?
      ORDER BY effective_from
    `).bind(to),

    db.prepare(`
      SELECT date,name
      FROM holidays
      WHERE date BETWEEN ? AND ?
    `).bind(from, to),

    db.prepare(`
      SELECT *
      FROM work_days
      WHERE work_date BETWEEN ? AND ?
      ${filter}
    `).bind(...args([from, to])),

    db.prepare(`
      SELECT p.work_day_id,p.seq,p.recorded_at
      FROM punches p
      JOIN work_days d ON d.id=p.work_day_id
      WHERE d.work_date BETWEEN ? AND ?
      ${dayFilter}
    `).bind(...args([from, to])),

    db.prepare(`
      SELECT a.work_day_id,a.payload_json,a.reason
      FROM adjustments a
      JOIN work_days d ON d.id=a.work_day_id
      WHERE d.work_date BETWEEN ? AND ?
      ${dayFilter}
      ORDER BY a.created_at,a.rowid
    `).bind(...args([from, to])),

    db.prepare(`
      SELECT *
      FROM occurrences
      WHERE work_date BETWEEN ? AND ?
      ${filter}
      ORDER BY created_at
    `).bind(...args([from, to])),

    db.prepare(`
      SELECT *
      FROM overtime_decisions
      WHERE work_date BETWEEN ? AND ?
      ${filter}
      ORDER BY created_at,rowid
    `).bind(...args([from, to])),

    db.prepare(`
      SELECT *
      FROM monthly_closures
      WHERE month=?
      ${filter}
    `).bind(...args([month]))
  ];

  const results = await db.batch(statements);
  const all = (i: number) =>
    results[i].results as any[];

  const revision = all(0)[0].value;
  const company = all(1)[0] as Report['company'];
  const employees = all(2) as Employee[];
  const assignments = all(3);
  const scheduleHistory = all(4);
  const rules = all(5);
  const holidays = all(6);
  const workDays = all(7);
  const punches = all(8);
  const adjustments = all(9);
  const occurrences = all(10);
  const overtime = all(11);
  const closures = all(12);

  const dates = datesBetween(from, to);

  // Organiza o historico por jornada.
  const historyMap = new Map<string, any[]>();

  for (const item of scheduleHistory) {
    const versions =
      historyMap.get(item.schedule_id) || [];

    versions.push(item);
    historyMap.set(item.schedule_id, versions);
  }

  const holidayMap = new Map(
    holidays.map(h => [h.date, h.name])
  );

  const workMap = new Map(
    workDays.map(d => [
      `${d.employee_id}:${d.work_date}`,
      d
    ])
  );

  const markMap =
    new Map<string, (number | null)[]>();

  for (const p of punches) {
    const m = markMap.get(p.work_day_id) ||
      [null, null, null, null];

    m[p.seq] = p.recorded_at;
    markMap.set(p.work_day_id, m);
  }

  const adjMap = new Map(
    adjustments.map(a => [a.work_day_id, a])
  );

  const overtimeMap = new Map(
    overtime.map(o => [
      `${o.employee_id}:${o.work_date}`,
      o
    ])
  );

  const occMap =
    new Map<string, Occurrence[]>();

  for (const o of occurrences) {
    const key =
      `${o.employee_id}:${o.work_date}`;

    occMap.set(key, [
      ...(occMap.get(key) || []),
      o
    ]);
  }

  return employees.map(employee => {
    const closure = closures.find(
      v => v.employee_id === employee.id
    );

    const closureMeta = closure
      ? {
          id: closure.id,
          status: closure.status,
          version: closure.version,
          closed_at: closure.closed_at,
          report_hash: closure.report_hash
        }
      : null;

    if (
      closure?.status === 'closed' &&
      !ignoreClosure
    ) {
      const frozen =
        JSON.parse(closure.snapshot_json) as Report;

      return {
        ...frozen,
        closure: closureMeta,
        revision
      };
    }

    const assigned = assignments.filter(
      a => a.employee_id === employee.id
    );

    const days = dates.map(date => {
      const day = workMap.get(
        `${employee.id}:${date}`
      );

      const a = assigned
        .filter(a => a.effective_from <= date)
        .at(-1);

      // Consulta os horarios que realmente
      // estavam em vigor na data do relatorio.
      const versions = a
        ? historyMap.get(a.schedule_id) || []
        : [];

      const version = versions
        .filter(v => v.effective_from <= date)
        .at(-1);

      // Um dia ja iniciado usa obrigatoriamente
      // a jornada gravada naquele dia.
      //
      // Nos demais dias, usa a versao historica
      // valida para aquela data.
      const schedule: Schedule | null = day
        ? JSON.parse(day.schedule_json) as Schedule
        : version
          ? {
              ...JSON.parse(version.config_json),
              name: version.name
            } as Schedule
          : a
            ? {
                ...JSON.parse(a.config_json),
                name: a.name
              } as Schedule
            : null;

      const rule: Rules = day
        ? JSON.parse(day.rules_json)
        : JSON.parse(
            rules
              .filter(r => r.effective_from <= date)
              .at(-1)?.config_json ||
            JSON.stringify(DEFAULT_RULES)
          );

      const raw = markMap.get(day?.id) ||
        [null, null, null, null];

      const adj = adjMap.get(day?.id);

      const marks = adj
        ? JSON.parse(
            adj.payload_json
          ) as (number | null)[]
        : raw;

      const decision = overtimeMap.get(
        `${employee.id}:${date}`
      );

      const validDecision =
        decision?.basis_hash ===
          sha256(JSON.stringify(marks))
          ? decision
          : undefined;

      const employed =
        date >= employee.admission_date &&
        (
          !employee.employment_end ||
          date <= employee.employment_end
        );

      return calculateDay({
        date,
        timezone:
          day?.timezone || company.timezone,
        schedule,
        rules: rule,
        marks,
        rawMarks: raw,
        adjusted: !!adj,
        adjustmentReason: adj?.reason,
        holiday: holidayMap.get(date),
        occurrences:
          occMap.get(`${employee.id}:${date}`) || [],
        overtime: validDecision,
        now,
        employed
      });
    });

    const weekly =
      new Map<string, typeof days>();

    for (const day of days) {
      const start = DateTime
        .fromISO(day.date)
        .startOf('week')
        .toISODate()!;

      weekly.set(start, [
        ...(weekly.get(start) || []),
        day
      ]);
    }

    return {
      employee,
      company,
      month,
      from,
      to,
      generated_at: now,
      days,
      totals: sumDays(days),
      weeks: [...weekly].map(
        ([start, d]) => ({
          from: d[0].date,
          to: d.at(-1)!.date,
          totals: sumDays(d)
        })
      ),
      closure: closureMeta,
      revision
    };
  });
}

export async function reportFor(
  c: Ctx,
  id: string,
  month: string,
  ignoreClosure = false
) {
  const rows = await reportsForMonth(
    c,
    month,
    id,
    ignoreClosure
  );

  ensure(
    rows[0],
    404,
    'employee_not_found',
    'Funcionário não encontrado.'
  );

  return rows[0];
}

// Retorna a jornada valida na data informada,
// preservando os horarios anteriores.
export async function scheduleFor(
  c: Ctx,
  id: string,
  date: string
) {
  const row = await c.get('db').prepare(`
    SELECT
      COALESCE(
        h.config_json,
        s.config_json
      ) AS config_json,
      COALESCE(
        h.name,
        s.name
      ) AS name
    FROM schedule_assignments a
    JOIN schedules s
      ON s.id = a.schedule_id
    LEFT JOIN schedule_history h
      ON h.id = (
        SELECT sh.id
        FROM schedule_history sh
        WHERE sh.schedule_id = a.schedule_id
          AND sh.effective_from <= ?
        ORDER BY
          sh.effective_from DESC,
          sh.id DESC
        LIMIT 1
      )
    WHERE a.employee_id = ?
      AND a.effective_from <= ?
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_assignment_cancellations cac
        WHERE cac.assignment_id = a.id
      )
    ORDER BY
      a.effective_from DESC,
      a.created_at DESC
    LIMIT 1
  `).bind(date, id, date).first<{
    config_json: string;
    name: string;
  }>();

  return row
    ? {
        ...JSON.parse(row.config_json),
        name: row.name
      } as Schedule
    : null;
}

export async function rulesFor(
  c: Ctx,
  date: string
): Promise<Rules> {
  const row = await c.get('db').prepare(`
    SELECT config_json
    FROM rule_versions
    WHERE effective_from <= ?
    ORDER BY effective_from DESC
    LIMIT 1
  `).bind(date).first<{
    config_json: string;
  }>();

  return row
    ? JSON.parse(row.config_json)
    : DEFAULT_RULES;
}
