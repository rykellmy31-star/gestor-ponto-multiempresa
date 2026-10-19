
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.9.21
//
// Valida conflitos com CPFs ja cadastrados.
//
// Somente D1 local temporario.
// Nao executa migracoes remotas.
// Nao modifica registros de producao.

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

describe('CR JORNADA - conflitos existentes de CPF', () => {
  it('identifica conflitos antes de importar novos vinculos', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-cpf-existing-')
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

      // Funcionarios ficticios.
      for (const [id, company, registration] of [
        ['employee-a', 'company-a', '001'],
        ['employee-b', 'company-a', '002'],
        ['employee-c', 'company-b', '003']
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

      const cpfKey = 'a'.repeat(64);

      // Vinculo ja existente na Empresa A.
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

      // A importacao futura deve consultar
      // registros existentes antes de gravar.
      const conflict = query(
        `SELECT employee_id
         FROM employee_cpf_links
         WHERE company_id = 'company-a'
           AND cpf_lookup_key = '${cpfKey}'`,
        directory
      );

      expect(conflict).toHaveLength(1);
      expect(conflict[0].employee_id).toBe('employee-a');

      // Employee-b nao pode assumir o CPF
      // ja utilizado na mesma empresa.
      const canImportB =
        conflict.length === 0;

      expect(canImportB).toBe(false);

      // Empresa B pode utilizar o mesmo CPF.
      const otherCompany = query(
        `SELECT employee_id
         FROM employee_cpf_links
         WHERE company_id = 'company-b'
           AND cpf_lookup_key = '${cpfKey}'`,
        directory
      );

      expect(otherCompany).toHaveLength(0);

      query(
        `INSERT INTO employee_cpf_links (
          employee_id, company_id, cpf_lookup_key,
          created_at, updated_at
        ) VALUES (
          'employee-c', 'company-b', '${cpfKey}',
          1760000000000, 1760000000000
        )`,
        directory
      );

      // Employee-a ja possui um vinculo.
      const existingEmployee = query(
        `SELECT company_id, cpf_lookup_key
         FROM employee_cpf_links
         WHERE employee_id = 'employee-a'`,
        directory
      );

      expect(existingEmployee).toHaveLength(1);

      // Os dois vinculos corretos continuam
      // em empresas diferentes.
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
          employee_id: 'employee-c',
          company_id: 'company-b'
        }
      ]);

      // Nenhuma importacao foi feita
      // para o funcionario em conflito.
      const blocked = query(
        `SELECT COUNT(*) AS total
         FROM employee_cpf_links
         WHERE employee_id = 'employee-b'`,
        directory
      );

      expect(Number(blocked[0].total)).toBe(0);

      // Integridade do banco.
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
