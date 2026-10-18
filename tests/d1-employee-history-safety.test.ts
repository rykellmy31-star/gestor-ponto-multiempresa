
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.2
// Teste de preservacao dos vinculos historicos.
// Executa SOMENTE no D1 local.
// Nao realiza deploy nem migracoes remotas.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

type Row = Record<string, unknown>;

function run(
  args: string[],
  directory: string
): string {
  return execFileSync(
    executable,
    [
      'd1',
      ...args,
      '--config',
      'wrangler.jsonc',
      '--local',
      '--persist-to',
      directory
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
}

function execute(
  statement: string,
  directory: string
): Row[] {
  const output = run(
    [
      'execute',
      'DB',
      '--command',
      statement,
      '--json'
    ],
    directory
  );

  const parsed = JSON.parse(output) as Array<{
    success: boolean;
    results: Row[];
  }>;

  expect(parsed[0].success).toBe(true);

  return parsed[0].results;
}

function insertCompany(
  directory: string,
  id: string
): void {
  execute(
    `INSERT INTO companies (
      id, name, document, slug,
      primary_color, timezone, status,
      created_at, updated_at
    ) VALUES (
      '${id}', '${id}', '${id}', '${id}',
      '#2563EB', 'America/Bahia', 'active',
      1760000000000, 1760000000000
    )`,
    directory
  );
}

function insertEmployee(
  directory: string,
  id: string,
  companyId: string,
  registration: string
): void {
  execute(
    `INSERT INTO employees (
      id, company_id, full_name,
      registration, job_title,
      admission_date, status, notes,
      created_at, updated_at
    ) VALUES (
      '${id}', '${companyId}', 'Funcionario ${id}',
      '${registration}', 'Atendente',
      '2026-01-01', 'active', '',
      1760000000000, 1760000000000
    )`,
    directory
  );
}

describe('CR JORNADA - preservacao dos historicos', () => {
  it('preserva funcionarios, jornadas e marcacoes', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-history-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      // Empresas independentes.
      insertCompany(directory, 'company-a');
      insertCompany(directory, 'company-b');

      // Matriculas diferentes enquanto a
      // restricao global antiga estiver ativa.
      insertEmployee(
        directory,
        'employee-a',
        'company-a',
        '001'
      );

      insertEmployee(
        directory,
        'employee-b',
        'company-b',
        '002'
      );

      // Jornada historica do funcionario A.
      execute(
        `INSERT INTO work_days (
          id, employee_id, work_date, timezone,
          schedule_json, rules_json,
          next_seq, created_at
        ) VALUES (
          'day-a',
          'employee-a',
          '2026-01-15',
          'America/Bahia',
          '{}',
          '{}',
          0,
          1760000000000
        )`,
        directory
      );

      // Marcacao original, preservando os
      // mecanismos existentes do banco.
      execute(
        `INSERT INTO punches (
          id, work_day_id, employee_id,
          seq, type, recorded_at,
          idempotency_key, ip_hash,
          receipt_hash
        ) VALUES (
          'punch-a',
          'day-a',
          'employee-a',
          0,
          'entry',
          1768471200000,
          'test-history-001',
          'test-ip-hash',
          'test-receipt-hash'
        )`,
        directory
      );

      const employees = execute(
        `SELECT id, company_id, registration
         FROM employees
         WHERE id IN ('employee-a', 'employee-b')
         ORDER BY id`,
        directory
      );

      expect(employees).toHaveLength(2);

      expect(employees[0]).toMatchObject({
        id: 'employee-a',
        company_id: 'company-a',
        registration: '001'
      });

      expect(employees[1]).toMatchObject({
        id: 'employee-b',
        company_id: 'company-b',
        registration: '002'
      });

      const history = execute(
        `SELECT
          p.id AS punch_id,
          p.employee_id,
          p.work_day_id,
          p.type,
          p.recorded_at,
          w.work_date,
          e.company_id
        FROM punches p
        JOIN work_days w
          ON w.id = p.work_day_id
        JOIN employees e
          ON e.id = p.employee_id
        WHERE p.id = 'punch-a'`,
        directory
      );

      expect(history).toHaveLength(1);

      expect(history[0]).toMatchObject({
        punch_id: 'punch-a',
        employee_id: 'employee-a',
        work_day_id: 'day-a',
        type: 'entry',
        work_date: '2026-01-15',
        company_id: 'company-a'
      });

      expect(Number(history[0].recorded_at)).toBe(
        1768471200000
      );

      const isolation = execute(
        `SELECT COUNT(*) AS total
         FROM punches p
         JOIN employees e
           ON e.id = p.employee_id
         WHERE e.company_id = 'company-b'`,
        directory
      );

      expect(Number(isolation[0].total)).toBe(0);

      // Verifica relacionamentos do banco.
      const violations = execute(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(violations).toHaveLength(0);

      // Garante que o trigger de sequencia
      // da marcacao continuou funcionando.
      const workDay = execute(
        `SELECT next_seq, last_at
         FROM work_days
         WHERE id = 'day-a'`,
        directory
      );

      expect(Number(workDay[0].next_seq)).toBe(1);
      expect(Number(workDay[0].last_at)).toBe(
        1768471200000
      );

    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);
});
