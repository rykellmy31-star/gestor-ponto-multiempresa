
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.6
// Teste da regra empresarial com arquivamento.
// Somente D1 local e temporario.
// Nenhum deploy ou migracao remota.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

type Row = Record<string, unknown>;

function run(args: string[], directory: string): string {
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

function query(sql: string, directory: string): Row[] {
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

function captureFailure(operation: () => void): string {
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

  throw new Error('Operacao deveria ser rejeitada.');
}

describe('CR JORNADA - arquivamento multiempresa 0017', () => {
  it('valida matriculas ativas, arquivadas e legadas', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-archive-candidate-')
    );

    try {
      run(['migrations', 'apply', 'DB'], directory);

      // Ensaio isolado da regra preparada na 0016.
      // Nao altera a tabela real employees.
      query(
        `CREATE TABLE employees_archive_candidate (
          id TEXT PRIMARY KEY,
          company_id TEXT REFERENCES companies(id),
          registration TEXT NOT NULL COLLATE NOCASE,
          deleted_at INTEGER
        )`,
        directory
      );

      query(
        `CREATE UNIQUE INDEX candidate_active_registration
         ON employees_archive_candidate (
           company_id,
           registration COLLATE NOCASE
         )
         WHERE deleted_at IS NULL
           AND company_id IS NOT NULL`,
        directory
      );

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

      // Funcionario arquivado da empresa A.
      query(
        `INSERT INTO employees_archive_candidate
         (id, company_id, registration, deleted_at)
         VALUES ('archived-a', 'company-a', '001', 1760000000000)`,
        directory
      );

      // Reutilizacao na mesma empresa.
      query(
        `INSERT INTO employees_archive_candidate
         (id, company_id, registration, deleted_at)
         VALUES ('active-a', 'company-a', '001', NULL)`,
        directory
      );

      // Mesma matricula em outra empresa.
      query(
        `INSERT INTO employees_archive_candidate
         (id, company_id, registration, deleted_at)
         VALUES ('active-b', 'company-b', '001', NULL)`,
        directory
      );

      // Funcionario legado sem empresa definida.
      query(
        `INSERT INTO employees_archive_candidate
         (id, company_id, registration, deleted_at)
         VALUES ('legacy', NULL, '001', NULL)`,
        directory
      );

      // Matricula duplicada ativa na mesma empresa:
      // deve continuar proibida.
      const duplicateError = captureFailure(() => {
        query(
          `INSERT INTO employees_archive_candidate
           (id, company_id, registration, deleted_at)
           VALUES ('duplicate-a', 'company-a', '001', NULL)`,
          directory
        );
      });

      expect(duplicateError).toMatch(
        /UNIQUE constraint failed/i
      );

      const rows = query(
        `SELECT id, company_id, registration, deleted_at
         FROM employees_archive_candidate
         ORDER BY id`,
        directory
      );

      expect(rows).toHaveLength(4);

      expect(rows.find(row => row.id === 'archived-a'))
        .toMatchObject({
          company_id: 'company-a',
          registration: '001',
          deleted_at: 1760000000000
        });

      expect(rows.find(row => row.id === 'active-a'))
        .toMatchObject({
          company_id: 'company-a',
          registration: '001'
        });

      expect(rows.find(row => row.id === 'active-b'))
        .toMatchObject({
          company_id: 'company-b',
          registration: '001'
        });

      const legacy = rows.find(row => row.id === 'legacy');

      expect(legacy).toBeDefined();
      expect(legacy?.company_id).toBeNull();

      // A tabela original permanece intacta.
      const original = query(
        'SELECT COUNT(*) AS total FROM employees',
        directory
      );

      expect(Number(original[0].total)).toBe(0);

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
  }, 180000);
});
