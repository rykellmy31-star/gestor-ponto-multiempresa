
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.4
// Auditoria das chaves estrangeiras de employees.
// Somente banco D1 local e temporario.
// Nao modifica o banco de producao.

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

describe('CR JORNADA - seguranca das foreign keys', () => {
  it('impede a reconstrucao com cascatas perigosas', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-fk-safety-')
    );

    try {
      run(
        ['migrations', 'apply', 'DB'],
        directory
      );

      const tables = query(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'`,
        directory
      );

      const references: Array<{
        table: string;
        onDelete: string;
      }> = [];

      for (const row of tables) {
        const table = String(row.name);

        // Identificadores obtidos do proprio
        // catalogo local do SQLite.
        const safeName = table.replace(/"/g, '""');

        const foreignKeys = query(
          `PRAGMA foreign_key_list("${safeName}")`,
          directory
        );

        for (const foreignKey of foreignKeys) {
          if (foreignKey.table === 'employees') {
            references.push({
              table,
              onDelete: String(foreignKey.on_delete)
            });
          }
        }
      }

      // O banco deve possuir referencias a employees.
      expect(references.length).toBeGreaterThan(0);

      // Impede exclusao em cascata de historicos.
      const cascades = references.filter(
        (reference) =>
          reference.onDelete.toUpperCase() === 'CASCADE'
      );

      expect(
        cascades,
        'ON DELETE CASCADE encontrado em employees'
      ).toHaveLength(0);

      // Impede que um DROP altere silenciosamente
      // referencias historicas para NULL.
      const setNull = references.filter(
        (reference) =>
          reference.onDelete.toUpperCase() === 'SET NULL'
      );

      expect(
        setNull,
        'ON DELETE SET NULL encontrado em employees'
      ).toHaveLength(0);

      // Confirma a integridade do banco.
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
