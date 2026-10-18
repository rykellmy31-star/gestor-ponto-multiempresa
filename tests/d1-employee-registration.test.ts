
import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// CR JORNADA - Passo 56
// Testes das restricoes de matricula no D1 local.
//
// Nenhuma operacao utiliza --remote.
// Nenhuma alteracao e feita no banco de producao.

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32'
    ? 'wrangler.cmd'
    : 'wrangler'
);

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

function execute(
  statement: string,
  directory: string
): string {
  return run(
    [
      'execute',
      'DB',
      '--command',
      statement,
      '--json'
    ],
    directory
  );
}

function createDatabase(): string {
  const directory = mkdtempSync(
    join(tmpdir(), 'cr-jornada-registration-')
  );

  try {
    run(
      ['migrations', 'apply', 'DB'],
      directory
    );

    return directory;
  } catch (error) {
    rmSync(directory, {
      recursive: true,
      force: true
    });

    throw error;
  }
}

function insertCompany(
  directory: string,
  id: string,
  slug: string
): void {
  execute(
    `INSERT INTO companies (
      id,
      name,
      document,
      slug,
      primary_color,
      timezone,
      status,
      created_at,
      updated_at
    ) VALUES (
      '${id}',
      'Empresa ${id}',
      '${id}',
      '${slug}',
      '#2563EB',
      'America/Bahia',
      'active',
      1760000000000,
      1760000000000
    )`,
    directory
  );
}

function insertEmployee(
  directory: string,
  id: string,
  companyId: string,
  registration: string
): void {
  execute(
    `INSERT INTO employees (
      id,
      company_id,
      full_name,
      registration,
      job_title,
      admission_date,
      status,
      notes,
      created_at,
      updated_at
    ) VALUES (
      '${id}',
      '${companyId}',
      'Funcionario ${id}',
      '${registration}',
      'Atendente',
      '2026-01-01',
      'active',
      '',
      1760000000000,
      1760000000000
    )`,
    directory
  );
}

// Captura o resultado de uma operacao que
// esperamos que seja rejeitada pelo banco.
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
    'A operacao foi aceita, mas deveria ter sido bloqueada.'
  );
}

describe('CR JORNADA - matriculas no D1 local', () => {
  it('identifica bloqueio global entre empresas', () => {
    const directory = createDatabase();

    try {
      insertCompany(
        directory,
        'company-a',
        'empresa-a'
      );

      insertCompany(
        directory,
        'company-b',
        'empresa-b'
      );

      insertEmployee(
        directory,
        'employee-a',
        'company-a',
        '001'
      );

      const error = captureFailure(() => {
        insertEmployee(
          directory,
          'employee-b',
          'company-b',
          '001'
        );
      });

      expect(error).toMatch(
        /UNIQUE constraint failed/i
      );
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);

  it('impede matriculas repetidas na mesma empresa', () => {
    const directory = createDatabase();

    try {
      insertCompany(
        directory,
        'company-a',
        'empresa-a'
      );

      insertEmployee(
        directory,
        'employee-a',
        'company-a',
        '002'
      );

      const error = captureFailure(() => {
        insertEmployee(
          directory,
          'employee-b',
          'company-a',
          '002'
        );
      });

      expect(error).toMatch(
        /UNIQUE constraint failed/i
      );
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);

  it('mantem integridade referencial', () => {
    const directory = createDatabase();

    try {
      insertCompany(
        directory,
        'company-a',
        'empresa-a'
      );

      insertEmployee(
        directory,
        'employee-a',
        'company-a',
        '003'
      );

      const result = execute(
        'PRAGMA foreign_key_check',
        directory
      );

      const parsed = JSON.parse(result);

      expect(parsed[0].results).toHaveLength(0);
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);
});
