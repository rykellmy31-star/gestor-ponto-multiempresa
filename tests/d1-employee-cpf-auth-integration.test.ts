
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hashPassword,
  verifyPassword
} from '../server/core/crypto';

import {
  employeeCpfLookupKey
} from '../server/core/employee-cpf';

import {
  resolveEmployeeCpfCredentials,
  type EmployeeCpfCandidate
} from '../server/core/employee-cpf-credentials';

// CR JORNADA - Passo 57.9.9
//
// Integra CPF, senhas reais (scrypt) e D1 local.
// Nao cria migracao permanente.
// Nao modifica autenticacao administrativa.
// Nao utiliza banco remoto.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

const CPF_SECRET =
  'cr-jornada-cpf-test-secret-local-2026';

const PASSWORD_PEPPER =
  'cr-jornada-password-pepper-test-local';

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

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

describe('CR JORNADA - autenticacao CPF integrada ao D1', () => {
  it('autoriza somente vinculos com senha valida', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-cpf-auth-')
    );

    try {
      run(['migrations', 'apply', 'DB'], directory);

      // Duas empresas independentes.
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

      // Funcionarios de empresas diferentes.
      // Matriculas distintas porque a restricao
      // global antiga ainda esta ativa.
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

      // Senhas independentes protegidas por scrypt.
      const hashA = await hashPassword(
        'SenhaEmpresaA2026!',
        PASSWORD_PEPPER
      );

      const hashB = await hashPassword(
        'SenhaEmpresaB2026!',
        PASSWORD_PEPPER
      );

      expect(hashA).not.toBe(hashB);

      // Contas de funcionarios reais no esquema local.
      for (const [userId, login, employeeId, hash] of [
        ['user-a', 'login-a', 'employee-a', hashA],
        ['user-b', 'login-b', 'employee-b', hashB]
      ]) {
        query(
          `INSERT INTO users (
            id, login, display_name, password_hash,
            role, employee_id, active,
            must_change_password,
            created_at, updated_at
          ) VALUES (
            '${userId}', '${login}', '${userId}',
            '${escapeSql(hash)}', 'employee',
            '${employeeId}', 1, 0,
            1760000000000, 1760000000000
          )`,
          directory
        );
      }

      // Indice composto para garantir que o
      // funcionario pertence a empresa informada.
      query(
        `CREATE UNIQUE INDEX
          cr57_auth_employee_company
         ON employees(id, company_id)`,
        directory
      );

      // Tabela experimental de localizacao segura.
      query(
        `CREATE TABLE cr57_auth_cpf_links (
          employee_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          cpf_lookup_key TEXT NOT NULL,

          FOREIGN KEY (employee_id, company_id)
            REFERENCES employees(id, company_id),

          UNIQUE(company_id, cpf_lookup_key)
        )`,
        directory
      );

      const cpfKey = employeeCpfLookupKey(
        '529.982.247-25',
        CPF_SECRET
      );

      query(
        `INSERT INTO cr57_auth_cpf_links (
          employee_id, company_id, cpf_lookup_key
        ) VALUES
          ('employee-a', 'company-a', '${cpfKey}'),
          ('employee-b', 'company-b', '${cpfKey}')`,
        directory
      );

      // Consulta usando o identificador protegido.
      const records = query(
        `SELECT
          u.id AS user_id,
          u.password_hash,
          u.active AS account_active,
          e.id AS employee_id,
          e.company_id,
          e.status AS employee_status,
          e.deleted_at,
          c.name AS company_name,
          c.status AS company_status
        FROM cr57_auth_cpf_links l
        JOIN employees e
          ON e.id = l.employee_id
         AND e.company_id = l.company_id
        JOIN companies c
          ON c.id = e.company_id
        JOIN users u
          ON u.employee_id = e.id
         AND u.role = 'employee'
        WHERE l.cpf_lookup_key = '${cpfKey}'
        ORDER BY e.company_id`,
        directory
      );

      expect(records).toHaveLength(2);

      const candidates: EmployeeCpfCandidate[] =
        records.map((row) => ({
          user_id: String(row.user_id),
          password_hash: String(row.password_hash),
          link: {
            employee_id: String(row.employee_id),
            company_id: String(row.company_id),
            company_name: String(row.company_name),
            company_status: String(row.company_status),
            employee_status: String(row.employee_status),
            deleted_at: row.deleted_at === null
              ? null
              : Number(row.deleted_at),
            account_active:
              Number(row.account_active) === 1
          }
        }));

      // Usa o verificador verdadeiro do projeto.
      const verify = (
        password: string,
        storedHash: string
      ) => verifyPassword(
        password,
        storedHash,
        PASSWORD_PEPPER
      );

      // Senha da empresa A libera apenas A.
      const accessA =
        await resolveEmployeeCpfCredentials(
          'SenhaEmpresaA2026!',
          candidates,
          verify
        );

      expect(accessA.mode).toBe('automatic');

      if (accessA.mode === 'automatic') {
        expect(accessA.link.company_id).toBe(
          'company-a'
        );
      }

      // Senha da empresa B libera apenas B.
      const accessB =
        await resolveEmployeeCpfCredentials(
          'SenhaEmpresaB2026!',
          candidates,
          verify
        );

      expect(accessB.mode).toBe('automatic');

      if (accessB.mode === 'automatic') {
        expect(accessB.link.company_id).toBe(
          'company-b'
        );
      }

      // Senha errada nao permite acesso.
      const denied =
        await resolveEmployeeCpfCredentials(
          'SenhaIncorreta2026!',
          candidates,
          verify
        );

      expect(denied.mode).toBe('denied');

      // Desativar conta B somente no banco local.
      query(
        `UPDATE users SET active = 0
         WHERE id = 'user-b'`,
        directory
      );

      const disabledRecords = query(
        `SELECT active FROM users
         WHERE id = 'user-b'`,
        directory
      );

      expect(Number(disabledRecords[0].active)).toBe(0);

      // Recarregar o estado da conta antes da
      // autorizacao, como a futura rota devera fazer.
      const refreshed = candidates.map((candidate) => ({
        ...candidate,
        link: {
          ...candidate.link,
          account_active:
            candidate.user_id === 'user-b'
              ? Number(disabledRecords[0].active) === 1
              : candidate.link.account_active
        }
      }));

      const disabledAccess =
        await resolveEmployeeCpfCredentials(
          'SenhaEmpresaB2026!',
          refreshed,
          verify
        );

      expect(disabledAccess.mode).toBe('denied');

      // Nenhuma sessao foi criada pelo ensaio.
      const sessions = query(
        'SELECT COUNT(*) AS total FROM sessions',
        directory
      );

      expect(Number(sessions[0].total)).toBe(0);

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
