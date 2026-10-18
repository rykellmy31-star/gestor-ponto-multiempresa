
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.5
// Ensaio da nova regra de matriculas.
// Nao altera a tabela employees.
// Usa exclusivamente D1 local temporario.

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

  throw new Error(
    'A operacao deveria ter sido rejeitada.'
  );
}

describe('CR JORNADA - candidato de matriculas 0017', () => {
  it('permite matriculas entre empresas e bloqueia duplicacao interna', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-candidate-')
    );

    try {
      run(['migrations', 'apply', 'DB'], directory);

      // Tabela de ensaio: apenas as colunas
      // necessarias para verificar a nova regra.
      //
      // Nao substitui employees e nao representa
      // ainda o esquema completo da migracao 0017.

      query(
        `CREATE TABLE employees_0017_candidate (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL
            REFERENCES companies(id),
          registration TEXT NOT NULL
            COLLATE NOCASE
        )`,
        directory
      );

      query(
        `CREATE UNIQUE INDEX
          candidate_company_registration
        ON employees_0017_candidate (
          company_id,
          registration COLLATE NOCASE
        )`,
        directory
      );

      for (const [id, slug] of [
        ['company-a', 'empresa-a'],
        ['company-b', 'empresa-b']
      ]) {
        query(
          `INSERT INTO companies (
            id, name, document, slug,
            primary_color, timezone, status,
            created_at, updated_at
          ) VALUES (
            '${id}', '${id}', '${id}', '${slug}',
            '#2563EB', 'America/Bahia', 'active',
            1760000000000, 1760000000000
          )`,
          directory
        );
      }

      // Empresa A: matricula 001.
      query(
        `INSERT INTO employees_0017_candidate
          (id, company_id, registration)
        VALUES ('employee-a', 'company-a', '001')`,
        directory
      );

      // Empresa B: mesma matricula, permitida.
      query(
        `INSERT INTO employees_0017_candidate
          (id, company_id, registration)
        VALUES ('employee-b', 'company-b', '001')`,
        directory
      );

      const rows = query(
        `SELECT id, company_id, registration
         FROM employees_0017_candidate
         ORDER BY id`,
        directory
      );

      expect(rows).toHaveLength(2);

      expect(rows[0]).toMatchObject({
        id: 'employee-a',
        company_id: 'company-a',
        registration: '001'
      });

      expect(rows[1]).toMatchObject({
        id: 'employee-b',
        company_id: 'company-b',
        registration: '001'
      });

      // A mesma empresa nao pode repetir a matricula.
      // COLLATE NOCASE tambem bloqueia variantes
      // que diferem apenas em letras maiusculas.

      const duplicateError = captureFailure(() => {
        query(
          `INSERT INTO employees_0017_candidate
            (id, company_id, registration)
          VALUES ('employee-c', 'company-a', '001')`,
          directory
        );
      });

      expect(duplicateError).toMatch(
        /UNIQUE constraint failed/i
      );

      // O ensaio nao deve modificar employees.
      const originalCount = query(
        'SELECT COUNT(*) AS total FROM employees',
        directory
      );

      expect(Number(originalCount[0].total)).toBe(0);

      // Nenhuma violacao de chave estrangeira.
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
