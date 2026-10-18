
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.8
// Identifica o risco de renomear tabelas com
// chaves estrangeiras no Cloudflare D1.
//
// Apenas tabelas ficticias e banco local.
// Nenhuma tabela real de funcionarios e alterada.

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

describe('CR JORNADA - risco de renomear employees', () => {
  it('demonstra a atualizacao automatica das referencias', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-rename-risk-')
    );

    try {
      // Prepara a estrutura original do projeto,
      // exclusivamente em uma base temporaria.
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      // Cria duas tabelas ficticias independentes
      // das tabelas verdadeiras do CR JORNADA.
      query(
        `CREATE TABLE cr57_parent_probe (
          id TEXT PRIMARY KEY,
          registration TEXT NOT NULL UNIQUE
        )`,
        directory
      );

      query(
        `CREATE TABLE cr57_child_probe (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL
            REFERENCES cr57_parent_probe(id)
        )`,
        directory
      );

      query(
        `INSERT INTO cr57_parent_probe
         (id, registration)
         VALUES ('employee-test', '001')`,
        directory
      );

      query(
        `INSERT INTO cr57_child_probe
         (id, employee_id)
         VALUES ('history-test', 'employee-test')`,
        directory
      );

      // Verifica o relacionamento original.
      const before = query(
        'PRAGMA foreign_key_list(cr57_child_probe)',
        directory
      );

      expect(before).toHaveLength(1);
      expect(before[0].table).toBe(
        'cr57_parent_probe'
      );

      // Simula somente o RENOMEAR da abordagem
      // antiga de reconstrucao.
      query(
        `ALTER TABLE cr57_parent_probe
         RENAME TO cr57_parent_old`,
        directory
      );

      // SQLite atualiza a referencia do filho
      // para o novo nome da tabela antiga.
      const after = query(
        'PRAGMA foreign_key_list(cr57_child_probe)',
        directory
      );

      expect(after).toHaveLength(1);

      expect(after[0].table).toBe(
        'cr57_parent_old'
      );

      // Demonstra que criar outra tabela com
      // o nome original nao redireciona o FK.
      query(
        `CREATE TABLE cr57_parent_probe (
          id TEXT PRIMARY KEY,
          registration TEXT NOT NULL
        )`,
        directory
      );

      const unchanged = query(
        'PRAGMA foreign_key_list(cr57_child_probe)',
        directory
      );

      expect(unchanged[0].table).toBe(
        'cr57_parent_old'
      );

      // O historico ficticio continua associado
      // ao identificador original.
      const history = query(
        `SELECT
          c.id,
          c.employee_id,
          p.registration
         FROM cr57_child_probe c
         JOIN cr57_parent_old p
           ON p.id = c.employee_id`,
        directory
      );

      expect(history).toHaveLength(1);

      expect(history[0]).toMatchObject({
        id: 'history-test',
        employee_id: 'employee-test',
        registration: '001'
      });

      // A renomeacao isolada nao pode causar
      // violacoes de integridade referencial.
      const violations = query(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(violations).toHaveLength(0);

      // Este teste NAO elimina a tabela antiga.
      // Ele demonstra por que uma estrategia de
      // DROP da tabela antiga seria perigosa.
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);
});
