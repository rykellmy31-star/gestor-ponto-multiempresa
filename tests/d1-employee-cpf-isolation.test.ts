
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.9.4
// Testa isolamento dos vinculos de CPF.
// Somente D1 local, em diretorio temporario.
// Nao altera a estrutura remota.

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
    'A operacao deveria ter sido bloqueada.'
  );
}

describe('CR JORNADA - isolamento dos vinculos CPF', () => {
  it('bloqueia vinculo com empresa incorreta', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-cpf-isolation-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      // Empresas de teste.
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

      // Funcionarios com empresas corretas.
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

      // Chave candidata composta.
      // Criada somente nesta base temporaria.
      //
      // Permite uma FK que verifica se employee_id
      // e company_id pertencem ao mesmo registro.
      query(
        `CREATE UNIQUE INDEX
          cr57_employee_company_reference
         ON employees(id, company_id)`,
        directory
      );

      // Tabela experimental.
      query(
        `CREATE TABLE cr57_secure_cpf_links (
          employee_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          cpf_lookup_key TEXT NOT NULL,

          FOREIGN KEY (employee_id, company_id)
            REFERENCES employees(id, company_id),

          UNIQUE(company_id, cpf_lookup_key)
        )`,
        directory
      );

      const cpfKey =
        'a'.repeat(64);

      // Vinculo correto com empresa A.
      query(
        `INSERT INTO cr57_secure_cpf_links
          (employee_id, company_id, cpf_lookup_key)
         VALUES (
          'employee-a', 'company-a', '${cpfKey}'
         )`,
        directory
      );

      // Mesmo CPF em outra empresa:
      // permitido para dois vinculos diferentes.
      query(
        `INSERT INTO cr57_secure_cpf_links
          (employee_id, company_id, cpf_lookup_key)
         VALUES (
          'employee-b', 'company-b', '${cpfKey}'
         )`,
        directory
      );

      // Tentativa de associar o funcionario A
      // a uma empresa diferente.
      //
      // Removemos primeiro seu vinculo
      // experimental para evitar um falso
      // positivo pela PRIMARY KEY.
      query(
        `DELETE FROM cr57_secure_cpf_links
         WHERE employee_id = 'employee-a'`,
        directory
      );

      const error = captureFailure(() => {
        query(
          `INSERT INTO cr57_secure_cpf_links
            (employee_id, company_id, cpf_lookup_key)
           VALUES (
            'employee-a',
            'company-b',
            '${'b'.repeat(64)}'
           )`,
          directory
        );
      });

      expect(error).toMatch(
        /FOREIGN KEY constraint failed/i
      );

      // Reestabelece o vinculo correto.
      query(
        `INSERT INTO cr57_secure_cpf_links
          (employee_id, company_id, cpf_lookup_key)
         VALUES (
          'employee-a', 'company-a', '${cpfKey}'
         )`,
        directory
      );

      const links = query(
        `SELECT
          l.employee_id,
          l.company_id
         FROM cr57_secure_cpf_links l
         JOIN employees e
           ON e.id = l.employee_id
          AND e.company_id = l.company_id
         ORDER BY l.employee_id`,
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

      // Nenhuma violacao referencial.
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
