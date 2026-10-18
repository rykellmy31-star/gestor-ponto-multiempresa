
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.1
// Auditoria da estrutura ANTES da migracao 0017.
//
// Somente D1 local, em diretorio temporario.
// Nenhum deploy e nenhuma migracao remota.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

function wrangler(
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

type D1Result = {
  results: Record<string, unknown>[];
  success: boolean;
};

function query(
  statement: string,
  directory: string
): Record<string, unknown>[] {
  const output = wrangler(
    [
      'execute',
      'DB',
      '--command',
      statement,
      '--json'
    ],
    directory
  );

  const parsed = JSON.parse(output) as D1Result[];

  expect(parsed[0].success).toBe(true);

  return parsed[0].results;
}

function withLocalDatabase(
  callback: (directory: string) => void
): void {
  const directory = mkdtempSync(
    join(tmpdir(), 'cr-jornada-safety-')
  );

  try {
    wrangler(
      ['migrations', 'apply', 'DB'],
      directory
    );

    callback(directory);
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true
    });
  }
}

describe('CR JORNADA - seguranca pre-migracao 0017', () => {
  it('confirma a estrutura atual de employees', () => {
    withLocalDatabase((directory) => {
      const columns = query(
        'PRAGMA table_info(employees)',
        directory
      );

      const names = columns.map(
        (column) => String(column.name)
      );

      for (const column of [
        'id',
        'registration',
        'company_id',
        'deleted_at',
        'deleted_by',
        'full_name',
        'status',
        'created_at',
        'updated_at'
      ]) {
        expect(names).toContain(column);
      }

      const schema = query(
        "SELECT sql FROM sqlite_master " +
        "WHERE type = 'table' AND name = 'employees'",
        directory
      );

      expect(String(schema[0].sql)).toMatch(
        /registration\s+TEXT\s+NOT\s+NULL\s+UNIQUE\s+COLLATE\s+NOCASE/i
      );
    });
  }, 180000);

  it('confirma os indices e protecoes empresariais', () => {
    withLocalDatabase((directory) => {
      const objects = query(
        "SELECT name, type FROM sqlite_master " +
        "WHERE tbl_name = 'employees'",
        directory
      );

      const names = objects.map(
        (object) => String(object.name)
      );

      for (const name of [
        'employees_company',
        'employees_company_registration_unique',
        'employees_company_registration_lookup',
        'employees_require_company',
        'employees_company_immutable',
        'employee_deleted_at_immutable'
      ]) {
        expect(names).toContain(name);
      }
    });
  }, 180000);

  it('identifica tabelas dependentes de employees', () => {
    withLocalDatabase((directory) => {
      const dependencies = [
        'users',
        'schedule_assignments',
        'work_days',
        'punches',
        'occurrences',
        'overtime_decisions',
        'monthly_closures'
      ];

      for (const table of dependencies) {
        const references = query(
          `PRAGMA foreign_key_list("${table}")`,
          directory
        );

        expect(
          references.some(
            (reference) =>
              reference.table === 'employees'
          ),
          `Referencia ausente em ${table}`
        ).toBe(true);
      }
    });
  }, 180000);

  it('identifica o login global legado', () => {
    withLocalDatabase((directory) => {
      const schema = query(
        "SELECT sql FROM sqlite_master " +
        "WHERE type = 'table' " +
        "AND name = 'login_identifiers'",
        directory
      );

      expect(schema).toHaveLength(1);

      expect(String(schema[0].sql)).toMatch(
        /identifier\s+TEXT\s+PRIMARY\s+KEY\s+COLLATE\s+NOCASE/i
      );
    });
  }, 180000);

  it('confirma integridade referencial do banco local', () => {
    withLocalDatabase((directory) => {
      const violations = query(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(violations).toHaveLength(0);
    });
  }, 180000);
});
