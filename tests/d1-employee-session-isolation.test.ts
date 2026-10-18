
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.9.10
// Ensaio de isolamento de sessoes por empresa.
// Apenas D1 local temporario.
// Nenhum deploy, nenhuma migracao remota.

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
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };

    return [
      details.message || '',
      String(details.stderr || ''),
      String(details.stdout || '')
    ].join('\n');
  }

  throw new Error(
    'Operacao deveria ter sido bloqueada.'
  );
}

describe('CR JORNADA - sessoes empresariais de funcionarios', () => {
  it('protege identidade e isolamento das sessoes', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-employee-session-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
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

      for (const [id, company, registration] of [
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
            '${id}', '${company}', '${id}',
            '${registration}', 'Atendente',
            '2026-01-01', 'active', '',
            1760000000000, 1760000000000
          )`,
          directory
        );
      }

      // Conta de funcionario da Empresa A.
      query(
        `INSERT INTO users (
          id, login, display_name, password_hash,
          role, employee_id, active,
          must_change_password,
          created_at, updated_at
        ) VALUES (
          'user-a', 'login-a', 'Funcionario A',
          'hash-ficticio', 'employee',
          'employee-a', 1, 0,
          1760000000000, 1760000000000
        )`,
        directory
      );

      // Necessario para a chave estrangeira composta.
      query(
        `CREATE UNIQUE INDEX
          cr57_session_employee_company
         ON employees(id, company_id)`,
        directory
      );

      // Tabela experimental de sessoes.
      query(
        `CREATE TABLE cr57_employee_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          employee_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,

          FOREIGN KEY (employee_id, company_id)
            REFERENCES employees(id, company_id)
        )`,
        directory
      );

      // Impede que uma sessao seja transferida
      // para outro funcionario ou empresa.
      query(
        `CREATE TRIGGER cr57_session_identity_immutable
         BEFORE UPDATE OF
           token_hash, user_id, employee_id, company_id
         ON cr57_employee_sessions
         BEGIN
           SELECT RAISE(
             ABORT,
             'employee_session_identity_immutable'
           );
         END`,
        directory
      );

      // Sessao experimental da Empresa A.
      query(
        `INSERT INTO cr57_employee_sessions (
          token_hash, user_id, employee_id,
          company_id, expires_at, created_at
        ) VALUES (
          'token-a', 'user-a', 'employee-a',
          'company-a', 1900000000000,
          1760000000000
        )`,
        directory
      );

      // Tentativa de transferir a sessao
      // para outra empresa.
      const transferError = captureFailure(() => {
        query(
          `UPDATE cr57_employee_sessions
           SET company_id = 'company-b'
           WHERE token_hash = 'token-a'`,
          directory
        );
      });

      expect(transferError).toMatch(
        /employee_session_identity_immutable/i
      );

      // Nao aceita vincular employee-a
      // a company-b em uma nova sessao.
      const foreignKeyError = captureFailure(() => {
        query(
          `INSERT INTO cr57_employee_sessions (
            token_hash, user_id, employee_id,
            company_id, expires_at, created_at
          ) VALUES (
            'token-invalid', 'user-a',
            'employee-a', 'company-b',
            1900000000000, 1760000000000
          )`,
          directory
        );
      });

      expect(foreignKeyError).toMatch(
        /FOREIGN KEY constraint failed/i
      );

      // Consulta empresarial com parametros
      // representados por valores fixos de teste.
      const companyA = query(
        `SELECT employee_id, company_id
         FROM cr57_employee_sessions
         WHERE token_hash = 'token-a'
           AND company_id = 'company-a'
           AND expires_at > 1800000000000`,
        directory
      );

      expect(companyA).toHaveLength(1);
      expect(companyA[0]).toMatchObject({
        employee_id: 'employee-a',
        company_id: 'company-a'
      });

      // A mesma sessao nao autoriza Empresa B.
      const companyB = query(
        `SELECT employee_id
         FROM cr57_employee_sessions
         WHERE token_hash = 'token-a'
           AND company_id = 'company-b'
           AND expires_at > 1800000000000`,
        directory
      );

      expect(companyB).toHaveLength(0);

      // Sessao expirada nao concede acesso.
      const expired = query(
        `SELECT token_hash
         FROM cr57_employee_sessions
         WHERE token_hash = 'token-a'
           AND expires_at > 2000000000000`,
        directory
      );

      expect(expired).toHaveLength(0);

      // Integridade referencial preservada.
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
