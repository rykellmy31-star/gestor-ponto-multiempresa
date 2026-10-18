
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  employeeCpfLookupKey
} from '../server/core/employee-cpf';

// CR JORNADA - Passo 57.9.3
// Ensaio de vinculos CPF + empresas.
// Somente banco D1 local temporario.
// Nao modifica as tabelas reais.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

const TEST_SECRET =
  'cr-jornada-test-secret-2026-not-production';

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

describe('CR JORNADA - vinculos CPF multiempresa', () => {
  it('isola dois vinculos do mesmo CPF', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-cpf-links-')
    );

    try {
      run(['migrations', 'apply', 'DB'], directory);

      // Empresas ficticias.
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

      // Funcionarios reais dentro do D1
      // local, preservando a restricao antiga.
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
            '${id}', '${company}',
            'Funcionario ${id}', '${registration}',
            'Atendente', '2026-01-01',
            'active', '', 1760000000000,
            1760000000000
          )`,
          directory
        );
      }

      // Tabela experimental de vinculos.
      // Nao altera a estrutura de employees.
      query(
        `CREATE TABLE cr57_cpf_links (
          employee_id TEXT PRIMARY KEY
            REFERENCES employees(id),
          company_id TEXT NOT NULL
            REFERENCES companies(id),
          cpf_lookup_key TEXT NOT NULL,
          UNIQUE(company_id, cpf_lookup_key)
        )`,
        directory
      );

      const cpfKey = employeeCpfLookupKey(
        '529.982.247-25',
        TEST_SECRET
      );

      // Nenhum CPF em texto puro no SQL.
      expect(cpfKey).toMatch(/^[a-f0-9]{64}$/);

      query(
        `INSERT INTO cr57_cpf_links
          (employee_id, company_id, cpf_lookup_key)
         VALUES
          ('employee-a', 'company-a', '${cpfKey}'),
          ('employee-b', 'company-b', '${cpfKey}')`,
        directory
      );

      // O mesmo CPF identifica dois vinculos.
      const links = query(
        `SELECT employee_id, company_id
         FROM cr57_cpf_links
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

      // Uma empresa deve visualizar
      // somente seu proprio vinculo.
      const companyA = query(
        `SELECT employee_id
         FROM cr57_cpf_links
         WHERE company_id = 'company-a'
           AND cpf_lookup_key = '${cpfKey}'`,
        directory
      );

      expect(companyA).toHaveLength(1);
      expect(companyA[0].employee_id).toBe('employee-a');

      // Nao permite cadastrar o mesmo CPF
      // duas vezes na mesma empresa.
      const duplicateError = captureFailure(() => {
        query(
          `INSERT INTO cr57_cpf_links
            (employee_id, company_id, cpf_lookup_key)
           VALUES
            ('employee-b', 'company-a', '${cpfKey}')`,
          directory
        );
      });

      expect(duplicateError).toMatch(
        /UNIQUE constraint failed/i
      );

      // Confirma integridade dos relacionamentos.
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
