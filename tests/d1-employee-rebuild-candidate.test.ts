
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.7
// Ensaio de reconstrucao da estrutura employees.
// Nao substitui nem exclui a tabela original.
// Executa somente no D1 local temporario.

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

function query(
  sql: string,
  directory: string
): Row[] {
  const output = run(
    ['execute', 'DB', '--command', sql, '--json'],
    directory
  );

  const parsed = JSON.parse(output) as Array<{
    success: boolean;
    results: Row[];
  }>;

  expect(parsed[0].success).toBe(true);

  return parsed[0].results;
}

function captureFailure(
  operation: () => void
): string {
  try {
    operation();
  } catch (error: unknown) {
    const details = error as {
      message?: string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };

    return [
      details.message || '',
      String(details.stdout || ''),
      String(details.stderr || '')
    ].join('\n');
  }

  throw new Error(
    'A operacao deveria ter sido rejeitada.'
  );
}

describe('CR JORNADA - ensaio de reconstrucao 0017', () => {
  it('preserva colunas e dados na tabela candidata', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-rebuild-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      // Criar duas empresas ficticias.
      for (const id of ['company-a', 'company-b']) {
        query(
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

      // Criar funcionarios no esquema original.
      for (const [id, companyId, registration] of [
        ['employee-a', 'company-a', '001'],
        ['employee-b', 'company-b', '002']
      ]) {
        query(
          `INSERT INTO employees (
            id, company_id, full_name,
            registration, job_title,
            admission_date, status, notes,
            created_at, updated_at
          ) VALUES (
            '${id}', '${companyId}',
            'Funcionario ${id}',
            '${registration}', 'Atendente',
            '2026-01-01', 'active', '',
            1760000000000, 1760000000000
          )`,
          directory
        );
      }

      // Registrar um historico real na estrutura
      // original, sem modificar os triggers.
      query(
        `INSERT INTO work_days (
          id, employee_id, work_date,
          timezone, schedule_json, rules_json,
          next_seq, created_at
        ) VALUES (
          'day-a', 'employee-a', '2026-01-15',
          'America/Bahia', '{}', '{}',
          0, 1760000000000
        )`,
        directory
      );

      query(
        `INSERT INTO punches (
          id, work_day_id, employee_id,
          seq, type, recorded_at,
          idempotency_key, ip_hash, receipt_hash
        ) VALUES (
          'punch-a', 'day-a', 'employee-a',
          0, 'entry', 1768471200000,
          'rebuild-test-001', 'test-ip',
          'test-receipt'
        )`,
        directory
      );

      // Obter a definicao verdadeira de employees.
      const schema = query(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table'
           AND name = 'employees'`,
        directory
      );

      expect(schema).toHaveLength(1);

      const originalSql = String(schema[0].sql);

      // Gerar copia experimental preservando
      // todas as colunas e demais restricoes.
      const tablePattern =
        /^CREATE TABLE\s+["'`]?employees["'`]?\s*\(/i;

      const registrationPattern =
        /registration\s+TEXT\s+NOT\s+NULL\s+UNIQUE\s+COLLATE\s+NOCASE/i;

      expect(originalSql).toMatch(tablePattern);
      expect(originalSql).toMatch(registrationPattern);

      const candidateSql = originalSql
        .replace(
          tablePattern,
          'CREATE TABLE employees_0017_candidate ('
        )
        .replace(
          registrationPattern,
          'registration TEXT NOT NULL COLLATE NOCASE'
        );

      expect(candidateSql).not.toMatch(
        registrationPattern
      );

      query(candidateSql, directory);

      // Listar todas as colunas para impedir
      // perda acidental durante a copia.
      const originalColumns = query(
        'PRAGMA table_info(employees)',
        directory
      );

      const candidateColumns = query(
        'PRAGMA table_info(employees_0017_candidate)',
        directory
      );

      expect(candidateColumns).toEqual(originalColumns);

      const columns = originalColumns
        .map((column) => {
          const name = String(column.name);
          return `"${name.replace(/"/g, '""')}"`;
        })
        .join(', ');

      // Copiar todas as colunas sem alterar IDs.
      query(
        `INSERT INTO employees_0017_candidate
         (${columns})
         SELECT ${columns}
         FROM employees`,
        directory
      );

      // Verificar igualdade completa dos dados.
      const originalRows = query(
        'SELECT * FROM employees ORDER BY id',
        directory
      );

      const candidateRows = query(
        'SELECT * FROM employees_0017_candidate ORDER BY id',
        directory
      );

      expect(candidateRows).toEqual(originalRows);
      expect(candidateRows).toHaveLength(2);

      // Reproduzir o indice parcial da migracao 0016.
      query(
        `CREATE UNIQUE INDEX
          candidate_0017_company_registration
         ON employees_0017_candidate (
           company_id,
           registration COLLATE NOCASE
         )
         WHERE deleted_at IS NULL
           AND company_id IS NOT NULL`,
        directory
      );

      // Agora a empresa B pode ter a mesma
      // matricula 001 da empresa A.
      query(
        `INSERT INTO employees_0017_candidate (
          id, company_id, full_name,
          registration, job_title,
          admission_date, status, notes,
          created_at, updated_at
        ) VALUES (
          'employee-c', 'company-b',
          'Funcionario C', '001',
          'Atendente', '2026-01-01',
          'active', '', 1760000000000,
          1760000000000
        )`,
        directory
      );

      // Duplicacao ativa na mesma empresa:
      // deve continuar bloqueada.
      const error = captureFailure(() => {
        query(
          `INSERT INTO employees_0017_candidate (
            id, company_id, full_name,
            registration, job_title,
            admission_date, status, notes,
            created_at, updated_at
          ) VALUES (
            'employee-d', 'company-a',
            'Funcionario D', '001',
            'Atendente', '2026-01-01',
            'active', '', 1760000000000,
            1760000000000
          )`,
          directory
        );
      });

      expect(error).toMatch(
        /UNIQUE constraint failed/i
      );

      // A tabela verdadeira nao pode receber
      // o terceiro funcionario neste ensaio.
      const originalCount = query(
        'SELECT COUNT(*) AS total FROM employees',
        directory
      );

      expect(Number(originalCount[0].total)).toBe(2);

      // Historico original ainda referenciado.
      const history = query(
        `SELECT
          p.id,
          p.employee_id,
          e.company_id
         FROM punches p
         JOIN employees e
           ON e.id = p.employee_id
         WHERE p.id = 'punch-a'`,
        directory
      );

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        id: 'punch-a',
        employee_id: 'employee-a',
        company_id: 'company-a'
      });

      // Verificacao final de integridade.
      const violations = query(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(violations).toHaveLength(0);

    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 240000);
});
