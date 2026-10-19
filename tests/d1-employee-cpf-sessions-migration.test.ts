import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// So utiliza D1 local com dados ficticios. Nao chama Worker nem banco remoto.
const wrangler = join(process.cwd(), 'node_modules', '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
function execute(args: string[], dir: string): string {
  return execFileSync(wrangler, [
    'd1', ...args, '--config', 'wrangler.jsonc', '--local', '--persist-to', dir
  ], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
function query(sql: string, dir: string): Array<Record<string, unknown>> {
  const output = execute(['execute', 'DB', '--command', sql, '--json'], dir);
  const parsed = JSON.parse(output) as Array<{
    success: boolean; results: Array<Record<string, unknown>>;
  }>;
  expect(parsed[0].success).toBe(true);
  return parsed[0].results || [];
}
function expectedFailure(sql: string, dir: string): string {
  try {
    query(sql, dir);
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return [e.message || '', String(e.stderr || ''), String(e.stdout || '')].join('\n');
  }
  throw new Error('Operacao indevida aceita pelo D1');
}

describe('CR JORNADA - migracao 0018 e isolamento de sessoes em D1 local', () => {
  it('aceita vinculo correto e recusa sessao de outra empresa ou desafio alterado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-jornada-session-0018-'));
    try {
      execute(['migrations', 'apply', 'DB'], dir);

      // Uma unica execucao de fixture reduz a sobrecarga do Wrangler.
      const fixture = join(dir, 'fixtures.sql');
      const statements = [
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES ('co-a','Empresa A','a','empresa-a',1760000000000,1760000000000)",
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES ('co-b','Empresa B','b','empresa-b',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES ('em-a','co-a','Funcionario A','100','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES ('em-b','co-b','Funcionario B','200','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO users(id,login,display_name,password_hash,role,employee_id,active,created_at,updated_at) VALUES ('us-a','usuario-a','Funcionario A','hash-teste','employee','em-a',1,1760000000000,1760000000000)",
        "INSERT INTO users(id,login,display_name,password_hash,role,employee_id,active,created_at,updated_at) VALUES ('us-b','usuario-b','Funcionario B','hash-teste','employee','em-b',1,1760000000000,1760000000000)",
        "INSERT INTO employee_cpf_links(employee_id,company_id,cpf_lookup_key,created_at,updated_at) VALUES ('em-a','co-a','" + 'a'.repeat(64) + "',1760000000000,1760000000000)",
        "INSERT INTO employee_cpf_links(employee_id,company_id,cpf_lookup_key,created_at,updated_at) VALUES ('em-b','co-b','" + 'a'.repeat(64) + "',1760000000000,1760000000000)",
        "INSERT INTO employee_company_sessions(token_hash,user_id,employee_id,company_id,csrf_token,created_at,expires_at,last_seen_at,auth_version) VALUES ('" + '1'.repeat(64) + "','us-a','em-a','co-a','csrf',1760000000000,1760003600000,1760000000000,1)",
        "INSERT INTO employee_login_challenges(token_hash,choices_json,created_at,expires_at) VALUES ('" + '2'.repeat(64) + "','[]',1760000000000,1760000300000)"
      ];
      writeFileSync(fixture, statements.join(';\n') + ';\n', 'utf8');
      const applied = execute(['execute', 'DB', '--file', fixture, '--json'], dir);
      expect(JSON.parse(applied).every((x: { success: boolean }) => x.success)).toBe(true);

      // Nao pode associar usuario da A ao empregado/empresa B.
      const mismatch = "INSERT INTO employee_company_sessions(token_hash,user_id,employee_id,company_id,csrf_token,created_at,expires_at,last_seen_at,auth_version) VALUES ('" +
        '3'.repeat(64) + "','us-a','em-b','co-b','csrf',1760000000000,1760003600000,1760000000000,1)";
      expect(expectedFailure(mismatch, dir)).toMatch(/FOREIGN KEY constraint failed/i);

      const tamper = "UPDATE employee_login_challenges SET choices_json='[1]' WHERE token_hash='" +
        '2'.repeat(64) + "'";
      expect(expectedFailure(tamper, dir)).toMatch(/employee_challenge_immutable/i);

      const sessions = query('SELECT user_id, employee_id, company_id FROM employee_company_sessions', dir);
      expect(sessions).toEqual([{ user_id: 'us-a', employee_id: 'em-a', company_id: 'co-a' }]);
      expect(query('PRAGMA foreign_key_check', dir)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);
});
