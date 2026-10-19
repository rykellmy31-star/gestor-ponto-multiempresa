import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrangler = join(process.cwd(), 'node_modules', '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
function execute(args: string[], dir: string) {
  return execFileSync(wrangler, [
    'd1', ...args, '--config', 'wrangler.jsonc', '--local', '--persist-to', dir
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'] });
}
function query(sql: string, dir: string): Array<Record<string, unknown>> {
  const output = execute(['execute', 'DB', '--command', sql, '--json'], dir);
  const parsed = JSON.parse(output) as Array<{
    success: boolean;
    results: Array<Record<string, unknown>>;
  }>;
  expect(parsed[0].success).toBe(true);
  return parsed[0].results || [];
}
function reject(sql: string, dir: string): string {
  try { query(sql, dir); } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return [err.message, String(err.stdout || ''), String(err.stderr || '')].join('\n');
  }
  throw new Error('A operacao deveria ter sido bloqueada');
}
describe('CR JORNADA - propriedade empresarial de jornadas no D1 local', () => {
  it('preserva legados e impede atribuicao de jornada A a funcionario B', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-jornada-tenant-schedule-'));
    try {
      execute(['migrations', 'apply', 'DB'], dir);
      const fixture = join(dir, 'fixture.sql');
      const config = JSON.stringify({
        start: '09:00', break_start: '12:00',
        break_end: '13:00', end: '18:00',
        paid_break: false, weekdays: [1,2,3,4,5]
      });
      const statements = [
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-a','Empresa A','a','empresa-a',1760000000000,1760000000000)",
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-b','Empresa B','b','empresa-b',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES('em-a','co-a','Pessoa A','100','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES('em-b','co-b','Pessoa B','200','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO schedules(id,company_id,name,config_json,created_at) VALUES('sc-a','co-a','Horario A','" + config + "',1760000000000)",
        "INSERT INTO schedules(id,company_id,name,config_json,created_at) VALUES('sc-b','co-b','Horario B','" + config + "',1760000000000)",
        "INSERT INTO schedules(id,name,config_json,created_at) VALUES('sc-legacy','Historico legado','" + config + "',1760000000000)",
        "INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES('asg-a','em-a','sc-a','2026-01-01',1760000000000)"
      ];
      writeFileSync(fixture, statements.join(';\n') + ';\n');
      const applied = JSON.parse(execute(['execute', 'DB', '--file', fixture, '--json'], dir));
      expect(applied.every((x: { success: boolean }) => x.success)).toBe(true);

      expect(reject(
        "INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES('asg-b','em-b','sc-a','2026-01-01',1760000000000)", dir
      )).toMatch(/schedule_company_mismatch/);

      expect(reject(
        "UPDATE schedule_assignments SET employee_id='em-b' WHERE id='asg-a'", dir
      )).toMatch(/schedule_company_mismatch/);

      expect(query(
        "SELECT employee_id FROM schedule_assignments WHERE id='asg-a'", dir
      )).toEqual([{ employee_id: 'em-a' }]);

      expect(reject(
        "UPDATE schedule_assignments SET schedule_id='sc-b' WHERE id='asg-a'", dir
      )).toMatch(/schedule_company_mismatch/);

      expect(query(
        "SELECT schedule_id FROM schedule_assignments WHERE id='asg-a'", dir
      )).toEqual([{ schedule_id: 'sc-a' }]);



      expect(query(
        "SELECT company_id FROM schedules WHERE id='sc-legacy'", dir
      )).toEqual([{ company_id: null }]);

      expect(reject(
        "UPDATE schedules SET company_id='co-inexistente' WHERE id='sc-legacy'", dir
      )).toMatch(/schedule_active_company_required/);
      expect(query(
        "SELECT company_id FROM schedules WHERE id='sc-legacy'", dir
      )).toEqual([{ company_id: null }]);

      expect(reject(
        "UPDATE schedules SET company_id='co-b' WHERE id='sc-a'", dir
      )).toMatch(/immutable/);

      expect(query('PRAGMA foreign_key_check', dir)).toHaveLength(0);
      expect(query(
        "SELECT employee_id FROM schedule_assignments WHERE schedule_id='sc-a'", dir
      )).toEqual([{ employee_id: 'em-a' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240000);
});
