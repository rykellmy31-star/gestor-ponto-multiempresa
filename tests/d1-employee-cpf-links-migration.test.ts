
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.9.14
// Valida a migracao 0017 no D1 local.
// Nenhuma operacao remota ou deploy.

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

  throw new Error('Operacao deveria ser bloqueada.');
}

describe('CR JORNADA - migracao 0017 CPF', () => {
  it('garante integridade dos vinculos empresariais', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-0017-')
    );

    try {
      run(['migrations', 'apply', 'DB'], directory);

      // Confirma que a tabela definitiva foi criada.
      const schema = query(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table'
           AND name = 'employee_cpf_links'`,
        directory
      );

      expect(schema).toHaveLength(1);

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

      // Matriculas distintas devido ao UNIQUE
      // global ainda existente em employees.
      for (const [id, company, registration] of [
        ['employee-a', 'company-a', '001'],
        ['employee-b', 'company-b', '002'],
        ['employee-c', 'company-a', '003']
      ]) {
        query(
          `INSERT INTO employees (
            id, company_id, full_name, registration,
            job_title, admission_date, status, notes,
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

      const cpfKey = 'a'.repeat(64);
      const anotherKey = 'b'.repeat(64);

      // O mesmo CPF pode ter vinculos
      // com empresas diferentes.
      query(
        `INSERT INTO employee_cpf_links (
          employee_id, company_id, cpf_lookup_key,
          created_at, updated_at
        ) VALUES (
          'employee-a', 'company-a', '${cpfKey}',
          1760000000000, 1760000000000
        )`,
        directory
      );

      query(
        `INSERT INTO employee_cpf_links (
          employee_id, company_id, cpf_lookup_key,
          created_at, updated_at
        ) VALUES (
          'employee-b', 'company-b', '${cpfKey}',
          1760000000000, 1760000000000
        )`,
        directory
      );

      const links = query(
        `SELECT employee_id, company_id
         FROM employee_cpf_links
         WHERE cpf_lookup_key = '${cpfKey}'
         ORDER BY company_id`,
        directory
      );

      expect(links).toEqual([
        {
          employee_id: 'employee-a',
          company_id: 'company-a'
        },
        {
          employee_id: 'employee-b',
          company_id: 'company-b'
        }
      ]);

      // Bloqueia CPF duplicado dentro
      // da mesma empresa.
      const duplicate = captureFailure(() => {
        query(
          `INSERT INTO employee_cpf_links (
            employee_id, company_id, cpf_lookup_key,
            created_at, updated_at
          ) VALUES (
            'employee-c', 'company-a', '${cpfKey}',
            1760000000000, 1760000000000
          )`,
          directory
        );
      });

      expect(duplicate).toMatch(
        /UNIQUE constraint failed/i
      );

      // Bloqueia funcionario associado
      // a uma empresa diferente.
      const wrongCompany = captureFailure(() => {
        query(
          `INSERT INTO employee_cpf_links (
            employee_id, company_id, cpf_lookup_key,
            created_at, updated_at
          ) VALUES (
            'employee-c', 'company-b', '${anotherKey}',
            1760000000000, 1760000000000
          )`,
          directory
        );
      });

      expect(wrongCompany).toMatch(
        /FOREIGN KEY constraint failed/i
      );

      // Impede chave de CPF com formato invalido.
      const invalidKey = captureFailure(() => {
        query(
          `INSERT INTO employee_cpf_links (
            employee_id, company_id, cpf_lookup_key,
            created_at, updated_at
          ) VALUES (
            'employee-c', 'company-a', 'cpf-invalido',
            1760000000000, 1760000000000
          )`,
          directory
        );
      });

      expect(invalidKey).toMatch(
        /CHECK constraint failed/i
      );

      // Impede troca da identidade protegida.
      const immutable = captureFailure(() => {
        query(
          `UPDATE employee_cpf_links
           SET cpf_lookup_key = '${anotherKey}'
           WHERE employee_id = 'employee-a'`,
          directory
        );
      });

      expect(immutable).toMatch(
        /employee_cpf_identity_immutable/i
      );

      // Impede exclusao direta do vinculo.
      const deletion = captureFailure(() => {
        query(
          `DELETE FROM employee_cpf_links
           WHERE employee_id = 'employee-a'`,
          directory
        );
      });

      expect(deletion).toMatch(
        /employee_cpf_no_delete/i
      );

      // Confirma que nenhuma tentativa
      // bloqueada modificou os vinculos.
      const total = query(
        `SELECT COUNT(*) AS total
         FROM employee_cpf_links`,
        directory
      );

      expect(Number(total[0].total)).toBe(2);

      // Preserva a integridade do banco.
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
