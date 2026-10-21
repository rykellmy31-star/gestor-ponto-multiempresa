import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
  existsSync, rmSync, statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const backupScript = resolve('scripts/backup.mjs');
const restoreScript = resolve('scripts/decrypt-backup.mjs');
const phrase = 'frase-ficticia-somente-ci-2026-mais-de-16-caracteres';

function run(script, args, cwd, password = phrase) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, BACKUP_PASSWORD: password }
  });
  return result;
}

test('backup D1 local cifra, restaura e rejeita fraude ou senha incorreta', () => {
  const folder = mkdtempSync(join(tmpdir(), 'cr-jornada-backup-test-'));
  try {
    // Nenhum recurso Cloudflare e acessado: a fixture usa SQLite local descartavel.
    writeFileSync(join(folder, 'wrangler.jsonc'), '{}');
    const persist = join(folder, 'persist');
    const databaseDirectory = join(persist, 'v3', 'd1');
    mkdirSync(databaseDirectory, { recursive: true });
    const original = new DatabaseSync(join(databaseDirectory, 'fixture.sqlite'));
    try {
      original.exec([
        'CREATE TABLE punches (id TEXT PRIMARY KEY, recorded_at INTEGER NOT NULL)',
        'CREATE TABLE employees (id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT)',
        "INSERT INTO punches VALUES ('punch-01',1761050000000)",
        "INSERT INTO employees VALUES ('employee-01','Funcionario Ficticio', 'Texto com aspas: ''teste''')"
      ].join(';') + ';');
    } finally {
      original.close();
    }

    const backup = run(backupScript, ['--local', '--persist-to', persist], folder);
    assert.equal(backup.status, 0, backup.stderr);
    const dir = join(folder, 'backups');
    const files = readdirSync(dir);
    const name = files.find(file => file.endsWith('.jdb'));
    assert.ok(name, 'backup .jdb esperado');
    assert.ok(files.includes(name + '.manifest.json'));
    const encrypted = join(dir, name);
    const encryptedBytes = readFileSync(encrypted);
    assert.equal((statSync(encrypted).mode & 0o777), 0o600);
    assert.equal(encryptedBytes.subarray(0, 10).toString(), 'JORNADABK1');
    assert.equal(encryptedBytes.includes(Buffer.from('Funcionario Ficticio')), false);

    const manifest = JSON.parse(readFileSync(encrypted + '.manifest.json', 'utf8'));
    assert.equal(manifest.mode, 'local');
    assert.equal(manifest.encryption, 'AES-256-GCM');
    assert.equal(manifest.bytes, encryptedBytes.length);

    const plainSql = join(folder, 'restored.sql');
    const decrypted = run(restoreScript, [encrypted, plainSql], folder);
    assert.equal(decrypted.status, 0, decrypted.stderr);
    assert.equal((statSync(plainSql).mode & 0o777), 0o600);

    const restored = new DatabaseSync(':memory:');
    try {
      restored.exec(readFileSync(plainSql, 'utf8'));
      assert.deepEqual({ ...restored.prepare('SELECT id, name, note FROM employees').get() }, {
        id: 'employee-01',
        name: 'Funcionario Ficticio',
        note: "Texto com aspas: 'teste'"
      });
      assert.equal(restored.prepare('SELECT COUNT(*) AS total FROM punches').get().total, 1);
    } finally {
      restored.close();
    }

    const wrongOutput = join(folder, 'wrong.sql');
    const wrong = run(restoreScript, [encrypted, wrongOutput], folder, 'senha-incorreta-ficticia');
    assert.notEqual(wrong.status, 0);
    assert.equal(existsSync(wrongOutput), false);
    assert.equal(existsSync(wrongOutput + '.partial'), false);

    const tampered = join(folder, 'altered.jdb');
    const copy = Buffer.from(encryptedBytes);
    copy[copy.length - 1] ^= 1;
    writeFileSync(tampered, copy);
    const tamperedOutput = join(folder, 'tampered.sql');
    const invalid = run(restoreScript, [tampered, tamperedOutput], folder);
    assert.notEqual(invalid.status, 0);
    assert.equal(existsSync(tamperedOutput), false);
    assert.equal(existsSync(tamperedOutput + '.partial'), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 180000);
