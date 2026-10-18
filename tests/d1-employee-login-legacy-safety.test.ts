
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.9.5
// Auditoria do login legado antes do CPF multiempresa.
//
// Somente D1 local temporario.
// Nao altera usuarios, senhas ou sessoes.
// Nenhuma migracao remota ou deploy.

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

  expect(parsed).toHaveLength(1);
  expect(parsed[0].success).toBe(true);

  return parsed[0].results;
}

describe('CR JORNADA - auditoria de login legado', () => {
  it('identifica restricoes globais antes do login por CPF', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-login-legacy-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      // Verifica a chave global de login.
      const table = query(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'login_identifiers'`,
        directory
      );

      expect(table).toHaveLength(1);

      const tableSql = String(table[0].sql);

      expect(tableSql).toMatch(
        /identifier\s+TEXT\s+PRIMARY\s+KEY\s+COLLATE\s+NOCASE/i
      );

      // Confirma que a matricula ainda participa
      // da criacao automatica dos identificadores.
      const triggers = query(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name IN (
             'identifiers_user_insert',
             'identifiers_user_update',
             'identifiers_registration'
           )
         ORDER BY name`,
        directory
      );

      expect(triggers).toHaveLength(3);

      const names = triggers.map(
        (trigger) => String(trigger.name)
      );

      expect(names).toContain('identifiers_user_insert');
      expect(names).toContain('identifiers_user_update');
      expect(names).toContain('identifiers_registration');

      for (const trigger of triggers) {
        const sql = String(trigger.sql);

        expect(sql).toMatch(/login_identifiers/i);
        expect(sql).toMatch(/registration/i);
      }

      // Confirma que a tabela users ainda
      // possui os campos de autenticacao.
      const columns = query(
        'PRAGMA table_info(users)',
        directory
      );

      const columnNames = columns.map(
        (column) => String(column.name)
      );

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('password_hash');
      expect(columnNames).toContain('employee_id');
      expect(columnNames).toContain('active');

      // Garante que esta auditoria nao criou
      // usuarios ou sessoes.
      const users = query(
        'SELECT COUNT(*) AS total FROM users',
        directory
      );

      const sessions = query(
        'SELECT COUNT(*) AS total FROM sessions',
        directory
      );

      expect(Number(users[0].total)).toBe(0);
      expect(Number(sessions[0].total)).toBe(0);

      // Integridade do banco local.
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
