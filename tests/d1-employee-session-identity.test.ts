
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.9.11
// Protecao da identidade nas sessoes empresariais.
//
// Testa:
// 1. Conta correta + funcionario correto + empresa.
// 2. Bloqueio de conta vinculada a outro funcionario.
// 3. Bloqueio de funcionario vinculado a outra empresa.
// 4. Integridade referencial.
//
// Exclusivamente D1 local temporario.
// Nao modifica sessions nem qualquer banco remoto.

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
    [
      'execute',
      'DB',
      '--command',
      sql,
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

function captureFailure(operation: () => void): string {
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

describe('CR JORNADA - identidade das sessoes', () => {
  it('impede combinar conta, funcionario e empresa incorretos', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-session-identity-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      // Duas empresas independentes.
      for (const id of [
        'company-a',
        'company-b'
      ]) {
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

      // Funcionarios com matriculas diferentes,
      // pois o UNIQUE global ainda existe.
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

      // Contas associadas a funcionarios distintos.
      for (const [userId, employeeId] of [
        ['user-a', 'employee-a'],
        ['user-b', 'employee-b']
      ]) {
        query(
          `INSERT INTO users (
            id, login, display_name,
            password_hash, role, employee_id,
            active, must_change_password,
            created_at, updated_at
          ) VALUES (
            '${userId}', '${userId}', '${userId}',
            'hash-ficticio', 'employee',
            '${employeeId}', 1, 0,
            1760000000000, 1760000000000
          )`,
          directory
        );
      }

      // Chaves candidatas para referencias
      // compostas na tabela experimental.
      query(
        `CREATE UNIQUE INDEX
          cr57_identity_user_employee
         ON users(id, employee_id)`,
        directory
      );

      query(
        `CREATE UNIQUE INDEX
          cr57_identity_employee_company
         ON employees(id, company_id)`,
        directory
      );

      // A sessao experimental exige que:
      //
      // user_id pertença a employee_id;
      // employee_id pertença a company_id.
      //
      // Ela nao substitui a tabela sessions atual.
      query(
        `CREATE TABLE cr57_identity_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          employee_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,

          FOREIGN KEY (user_id, employee_id)
            REFERENCES users(id, employee_id),

          FOREIGN KEY (employee_id, company_id)
            REFERENCES employees(id, company_id)
        )`,
        directory
      );

      // Sessao correta: deve ser aceita.
      query(
        `INSERT INTO cr57_identity_sessions (
          token_hash, user_id, employee_id,
          company_id, created_at, expires_at
        ) VALUES (
          'test-token-a',
          'user-a',
          'employee-a',
          'company-a',
          1760000000000,
          1900000000000
        )`,
        directory
      );

      // Ataque: user-a tentando se apresentar
      // como employee-b da Empresa B.
      const wrongUser = captureFailure(() => {
        query(
          `INSERT INTO cr57_identity_sessions (
            token_hash, user_id, employee_id,
            company_id, created_at, expires_at
          ) VALUES (
            'test-token-invalid-1',
            'user-a',
            'employee-b',
            'company-b',
            1760000000000,
            1900000000000
          )`,
          directory
        );
      });

      expect(wrongUser).toMatch(
        /FOREIGN KEY constraint failed/i
      );

      // Ataque: employee-a associado
      // indevidamente a company-b.
      const wrongCompany = captureFailure(() => {
        query(
          `INSERT INTO cr57_identity_sessions (
            token_hash, user_id, employee_id,
            company_id, created_at, expires_at
          ) VALUES (
            'test-token-invalid-2',
            'user-a',
            'employee-a',
            'company-b',
            1760000000000,
            1900000000000
          )`,
          directory
        );
      });

      expect(wrongCompany).toMatch(
        /FOREIGN KEY constraint failed/i
      );

      // Confirma que somente a sessao
      // correta foi cadastrada.
      const sessions = query(
        `SELECT
          token_hash,
          user_id,
          employee_id,
          company_id
         FROM cr57_identity_sessions`,
        directory
      );

      expect(sessions).toHaveLength(1);

      expect(sessions[0]).toMatchObject({
        token_hash: 'test-token-a',
        user_id: 'user-a',
        employee_id: 'employee-a',
        company_id: 'company-a'
      });

      // Verifica integridade referencial.
      const violations = query(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(violations).toHaveLength(0);

      // A tabela real sessions nao foi alterada.
      const originalSessions = query(
        'SELECT COUNT(*) AS total FROM sessions',
        directory
      );

      expect(
        Number(originalSessions[0].total)
      ).toBe(0);

    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);
});
