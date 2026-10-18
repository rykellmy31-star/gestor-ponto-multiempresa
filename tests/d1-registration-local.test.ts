
import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const config = 'wrangler.jsonc';

function runWrangler(
  args: string[],
  persistDir: string
): string {
  const executable =
    process.platform === 'win32'
      ? 'wrangler.cmd'
      : 'wrangler';

  return execFileSync(
    join(process.cwd(), 'node_modules', '.bin', executable),
    [
      ...args,
      '--config',
      config,
      '--local',
      '--persist-to',
      persistDir
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000
    }
  );
}

function sql(
  statement: string,
  persistDir: string
): string {
  return runWrangler(
    [
      'd1',
      'execute',
      'DB',
      '--command',
      statement
    ],
    persistDir
  );
}

describe('CR JORNADA - D1 local', () => {
  it('verifica as restricoes atuais de matricula', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'cr-jornada-d1-')
    );

    try {
      runWrangler(
        ['d1', 'migrations', 'apply', 'DB'],
        directory
      );

      const schema = sql(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employees'",
        directory
      );

      expect(schema).toMatch(
        /registration/i
      );

      expect(schema).toMatch(
        /UNIQUE/i
      );

      const indexes = sql(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'employees'",
        directory
      );

      expect(indexes).toContain(
        'employees_company_registration_unique'
      );

      const integrity = sql(
        'PRAGMA foreign_key_check',
        directory
      );

      expect(integrity).toBeDefined();
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true
      });
    }
  }, 180000);
});
