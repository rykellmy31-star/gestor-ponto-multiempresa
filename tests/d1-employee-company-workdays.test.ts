import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// D1 estritamente local, nunca --remote; nenhuma empresa verdadeira.
const wrangler = join(process.cwd(), 'node_modules', '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');

function execute(args: string[], dir: string) {
  return execFileSync(wrangler,
    ['d1', ...args, '--config', 'wrangler.jsonc', '--local', '--persist-to', dir],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

function query(sql: string, dir: string): Array<Record<string, unknown>> {
  const output = execute(['execute', 'DB', '--command', sql, '--json'], dir);
  const parsed = JSON.parse(output) as Array<{
    success: boolean; results: Array<Record<string, unknown>>;
  }>;
  expect(parsed[0].success).toBe(true);
  return parsed[0].results || [];
}

function rejected(sql: string, dir: string): string {
  try { query(sql, dir); }
  catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return [e.message, String(e.stdout || ''), String(e.stderr || '')].join('\n');
  }
  throw new Error('D1 permitiu um vinculo empresarial indevido.');
}

describe('CR JORNADA - dias e marcacoes por empresa no D1', () => {
  it('aceita o dia correto, preserva legados e impede vazamento entre empresas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-jornada-work-days-tenant-'));
    try {
      execute(['migrations', 'apply', 'DB'], dir);
      const fixture = join(dir, 'fixture.sql');
      const commands = [
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-a','Empresa A','a','empresa-a',1760000000000,1760000000000)",
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-b','Empresa B','b','empresa-b',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES('em-a','co-a','Pessoa A','100','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES('em-b','co-b','Pessoa B','200','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO company_punch_policies(company_id,enabled,rules_json,updated_at) VALUES('co-a',1,'{}',1760000000000)",
        "INSERT INTO work_days(id,company_id,employee_id,work_date,timezone,schedule_json,rules_json,next_seq,created_at) VALUES('day-a','co-a','em-a','2026-10-10','America/Bahia','{}','{}',0,1760000000000)",
        "INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,next_seq,created_at) VALUES('day-legacy','em-b','2026-10-11','America/Bahia','{}','{}',0,1760000000000)",
        "INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash) VALUES('punch-a','day-a','em-a',0,'entry',1791648000000,'idempotent-a','ip-hash-test','receipt-test')"
      ];
      writeFileSync(fixture, commands.join(';\n') + ';\n', 'utf8');
      const result = JSON.parse(
        execute(['execute', 'DB', '--file', fixture, '--json'], dir)
      ) as Array<{ success: boolean }>;
      expect(result.every(row => row.success)).toBe(true);

      expect(query(
        "SELECT company_id FROM work_days WHERE id='day-legacy'", dir
      )).toEqual([{ company_id: null }]);
      expect(query(
        "SELECT company_id,next_seq FROM work_days WHERE id='day-a'", dir
      )).toEqual([{ company_id: 'co-a', next_seq: 1 }]);

      expect(rejected(
        "INSERT INTO work_days(id,company_id,employee_id,work_date,timezone,schedule_json,rules_json,created_at) VALUES('forged','co-b','em-a','2026-10-12','America/Bahia','{}','{}',1760000000000)",
        dir
      )).toMatch(/work_day_company_mismatch/);

      expect(rejected(
        "UPDATE work_days SET company_id='co-a' WHERE id='day-legacy'", dir
      )).toMatch(/work_day_company_mismatch/);

      expect(rejected(
        "UPDATE work_days SET company_id='co-b' WHERE id='day-a'", dir
      )).toMatch(/work_day_company_immutable/);

      query("UPDATE employees SET status='inactive' WHERE id='em-b'", dir);
      expect(rejected(
        "UPDATE work_days SET company_id='co-b' WHERE id='day-legacy'", dir
      )).toMatch(/work_day_company_mismatch/);
      expect(query(
        "SELECT company_id FROM work_days WHERE id='day-legacy'", dir
      )).toEqual([{ company_id: null }]);



      expect(rejected(
        "INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash) VALUES('forged-punch','day-a','em-b',1,'break_start',1791651600000,'forged-key','ip-hash-test','receipt-test')",
        dir
      )).toMatch(/(?:punch_company_mismatch|employee_mismatch)/);

      expect(query(
        "SELECT id FROM punches WHERE work_day_id='day-a' ORDER BY seq", dir
      )).toEqual([{ id: 'punch-a' }]);
      expect(query('PRAGMA foreign_key_check', dir)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);
});
