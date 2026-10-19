import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSERT_EMPLOYEE_CPF_LINK_SQL } from '../server/core/employee-cpf-import';

// Somente D1 local temporario. Nunca usa --remote.
const executable = join(process.cwd(), 'node_modules', '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');

type Row = Record<string, unknown>;

function run(args: string[], directory: string): string {
  return execFileSync(executable,
    ['d1', ...args, '--config', 'wrangler.jsonc', '--local', '--persist-to', directory],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'] }
  );
}
function query(statement: string, directory: string): Row[] {
  const output = run(['execute', 'DB', '--command', statement, '--json'], directory);
  const parsed = JSON.parse(output) as Array<{ success: boolean; results: Row[] }>;
  expect(parsed[0].success).toBe(true);
  return parsed[0].results;
}
function setup(directory: string): void {
  for (const id of ['a', 'b']) {
    query("INSERT INTO companies (id,name,document,slug,primary_color,timezone,status,created_at,updated_at) VALUES (" +
      "'company-" + id + "','Empresa " + id + "','" + id + "','empresa-" + id + "'," +
      "'#2563EB','America/Bahia','active',1760000000000,1760000000000)", directory);
  }
  for (const [id, company, registration] of [
    ['employee-a', 'company-a', '001'],
    ['employee-b', 'company-b', '002'],
    ['employee-c', 'company-a', '003']
  ]) {
    query("INSERT INTO employees (id,company_id,full_name,registration,job_title,admission_date,status,notes,cpf_encrypted,created_at,updated_at) VALUES (" +
      "'" + id + "','" + company + "','" + id + "','" + registration + "'," +
      "'Atendente','2026-01-01','active','','encrypted-example',1760000000000,1760000000000)", directory);
  }
}
// Apenas valores fixos de teste. Nunca interpolar dados de usuarios em SQL real.
function insertSql(employeeId: string, companyId: string, cpfKey: string): string {
  const values: Array<string | number> = [
    employeeId, employeeId, companyId, companyId,
    cpfKey, 1760000000000, 1760000000000
  ];
  let offset = 0;
  return INSERT_EMPLOYEE_CPF_LINK_SQL.replace(/\?/g, () => {
    const value = values[offset++];
    return typeof value === 'number' ? String(value) : "'" + value.replace(/'/g, "''") + "'";
  });
}
function failure(statement: string, directory: string): string {
  try { query(statement, directory); } catch (error: unknown) {
    const e = error as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer };
    return [e.message || '', String(e.stdout || ''), String(e.stderr || '')].join('\n');
  }
  throw new Error('A operacao deveria ser rejeitada');
}
describe('CR JORNADA - SQL real de importacao de CPF no D1 local', () => {
  it('aceita duas empresas e rejeita vinculo errado, repetido ou bloqueado', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cr-jornada-import-sql-'));
    try {
      run(['migrations', 'apply', 'DB'], directory);
      setup(directory);
      const keyA = 'a'.repeat(64), keyB = 'b'.repeat(64);
      query(insertSql('employee-a', 'company-a', keyA), directory);
      query(insertSql('employee-b', 'company-b', keyA), directory);
      expect(failure(insertSql('employee-c', 'company-a', keyA), directory))
        .toMatch(/UNIQUE constraint failed/i);
      expect(failure(insertSql('employee-c', 'company-b', keyB), directory))
        .toMatch(/NOT NULL constraint failed|FOREIGN KEY constraint failed/i);
      query("UPDATE employees SET status='blocked' WHERE id='employee-c'", directory);
      expect(failure(insertSql('employee-c', 'company-a', keyB), directory))
        .toMatch(/NOT NULL constraint failed/i);
      expect(query('SELECT employee_id,company_id FROM employee_cpf_links ORDER BY company_id', directory))
        .toEqual([
          { employee_id: 'employee-a', company_id: 'company-a' },
          { employee_id: 'employee-b', company_id: 'company-b' }
        ]);
      expect(query('PRAGMA foreign_key_check', directory)).toHaveLength(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 240000);
});
