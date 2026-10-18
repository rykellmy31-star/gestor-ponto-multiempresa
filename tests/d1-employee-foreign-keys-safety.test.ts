
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CR JORNADA - Passo 57.4 - CORRIGIDO
// Auditoria das chaves estrangeiras de employees.
//
// Consulta apenas tabelas conhecidas do CR JORNADA.
// Nao acessa tabelas internas do Cloudflare.
// Somente D1 local e temporario.
// Nenhum deploy ou migracao remota.

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

      // Apenas tabelas do sistema que possuem
      // referencias diretas a employees.
      //
      // Evita consultar _cf_METADATA e outras
      // tabelas internas protegidas pelo D1.

      const tables = [
        'users',
        'schedule_assignments',
        'work_days',
        'punches',
        'occurrences',
        'overtime_decisions',
        'monthly_closures'
      ];

      const references: Array<{
        table: string;
        onDelete: string;
      }> = [];

      for (const table of tables) {
        const foreignKeys = query(
          `PRAGMA foreign_key_list("${table}")`,
          directory
        );

        const employeeReferences = foreignKeys.filter(
          (foreignKey) =>
            foreignKey.table === 'employees'
        );

        // Cada tabela listada deve continuar
        // referenciando employees.
        expect(
          employeeReferences.length,
          `Referencia ausente em ${table}`
        ).toBeGreaterThan(0);

        for (const foreignKey of employeeReferences) {
          references.push({
            table,
            onDelete: String(foreignKey.on_delete)
          });
        }
      }

      expect(references.length).toBeGreaterThan(0);

      // Impede exclusao automatica em cascata.
      const cascades = references.filter(
        (reference) =>
          reference.onDelete.toUpperCase() === 'CASCADE'
      );

      expect(
        cascades,
        'ON DELETE CASCADE encontrado'
      ).toHaveLength(0);

      // Impede alteracao automatica das referencias.
      const setNull = references.filter(
        (reference) =>
          reference.onDelete.toUpperCase() === 'SET NULL'
      );

      expect(
        setNull,
        'ON DELETE SET NULL encontrado'
      ).toHaveLength(0);

      // Confirma integridade referencial local.
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
