
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.3
// Auditoria antes da reconstrucao de employees.
// Executa apenas em D1 local temporario.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

type Row = Record<string, unknown>;

function execute(
  sql: string,
  directory: string
): Row[] {
  const output = execFileSync(
    executable,
    [
      'd1',
      'execute',
      'DB',
      '--command',
      sql,
      '--json',
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

  const parsed = JSON.parse(output) as Array<{
    success: boolean;
    results: Row[];
  }>;

  expect(parsed[0].success).toBe(true);
  return parsed[0].results;
}

function withDatabase(
  callback: (directory: string) => void
): void {
  const directory = mkdtempSync(
    join(tmpdir(), 'cr-jornada-preflight-')
  );

  try {
    execFileSync(
      executable,
      [
        'd1',
        'migrations',
        'apply',
        'DB',
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

    callback(directory);
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
}

describe('CR JORNADA - preflight 0017', () => {
  it('identifica funcionarios legados sem empresa', () => {
    withDatabase((directory) => {
      const rows = execute(
        `SELECT COUNT(*) AS total
         FROM employees
         WHERE company_id IS NULL`,
        directory
      );

      expect(rows).toHaveLength(1);
      expect(Number(rows[0].total)).toBeGreaterThanOrEqual(0);

      // Este teste documenta a situacao local.
      // Nao atribui empresa automaticamente.
    });
  }, 180000);

  it('identifica triggers e indices a preservar', () => {
    withDatabase((directory) => {
      const objects = execute(
        `SELECT name, type, sql
         FROM sqlite_master
         WHERE tbl_name = 'employees'
           AND type IN ('index', 'trigger')
         ORDER BY type, name`,
        directory
      );

      const names = objects.map(
        (row) => String(row.name)
      );

      const required = [
        'employees_company',
        'employees_company_registration_unique',
        'employees_company_registration_lookup',
        'employees_require_company',
        'employees_company_immutable',
        'employee_deleted_at_immutable',
        'revision_employees_insert',
        'revision_employees_update',
        'identifiers_registration'
      ];

      for (const name of required) {
        expect(
          names,
          `Objeto ausente: ${name}`
        ).toContain(name);
      }

      const fk = execute(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(fk).toHaveLength(0);
    });
  }, 180000);
});
