import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, existsSync,
  rmSync, appendFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createClient, validateStagingDatabase } from './provision-cloudflare-staging.mjs';
import { createStagingConfig } from './prepare-cloudflare-staging.mjs';
import { assertStagingTarget, STAGING_DATABASE, STAGING_WORKER, STAGING_ORIGIN } from './staging-guard.mjs';
import { LIVE_D1_ID } from './verify-production-target.mjs';

process.umask(0o077);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_STAGING_TOKEN;
const api = createClient({ token, accountId });
const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
let staging;
if (existsSync('wrangler.staging.jsonc')) staging = JSON.parse(readFileSync('wrangler.staging.jsonc', 'utf8'));
else {
  const matches = (await api('/d1/database?name=' + STAGING_DATABASE + '&per_page=100')).result?.filter(d => d.name === STAGING_DATABASE);
  assert.equal(matches?.length, 1, 'D1 staging unico identificado');
  const id = validateStagingDatabase(matches[0]);
  staging = createStagingConfig(base, { worker: STAGING_WORKER, database: STAGING_DATABASE,
    databaseId: id, origin: STAGING_ORIGIN });
  for (const key of ['ENABLE_COMPANY_SCHEDULES','ENABLE_COMPANY_EMPLOYEE_REGISTRATION',
    'ENABLE_EMPLOYEE_PASSWORD_RECOVERY','ENABLE_EMPLOYEE_PUNCHES']) staging.vars[key] = 'true';
  assertStagingTarget(staging, accountId, base, { exerciseFeatures: true });
  writeFileSync('wrangler.staging.jsonc', JSON.stringify(staging), { mode: 0o600 });
}
const sourceId = assertStagingTarget(staging, accountId, base, { exerciseFeatures: true });
validateStagingDatabase((await api('/d1/database/' + sourceId)).result);
const restoreName = 'cr-jornada-staging-restore-' + randomBytes(6).toString('hex');
const password = randomBytes(48).toString('hex');
console.log('::add-mask::' + password);
mkdirSync('.private', { recursive: true, mode: 0o700 });
const folder = mkdtempSync(resolve('.private/recovery-'));
const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, BACKUP_PASSWORD: password, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    const output = (result.stdout || '') + (result.stderr || '');
    const categories = [
      ['foreign_key', /FOREIGN KEY constraint failed|foreign key mismatch/i],
      ['not_authorized', /not authorized|SQLITE_AUTH|Authentication error|permission denied/i],
      ['schema_exists', /already exists|UNIQUE constraint failed/i],
      ['missing_table', /no such table/i],
      ['file_missing', /no such file|does not exist|could not read|could not find.*file/i],
      ['syntax', /syntax error|Unknown argument|unrecognized token/i],
      ['immutable_trigger', /immutable|no_delete|no_implicit_replacement|owner_invalid|company_mismatch/i],
      ['transaction', /transaction|SAVEPOINT/i]
    ].filter(([,pattern]) => pattern.test(output)).map(([name]) => name);
    const codes = [...new Set(output.match(/\b(?:SQLITE_[A-Z_]+|D1_[A-Z_]+)\b/g) || [])];
    throw new Error('Recuperacao staging falhou em ' + script.split('/').at(-1) + ' ' + args.slice(0,2).join(' ') +
      '; categorias=' + (categories.join(',') || 'desconhecida') + '; codigos=' + (codes.join(',') || 'indisponiveis'));
  }
  return result.stdout;
};
const query = async (id, sql) => {
  assert.ok(id !== LIVE_D1_ID && /^[0-9a-f-]{36}$/i.test(id), 'Consulta somente em D1 de testes');
  const response = await api('/d1/database/' + id + '/query', { method: 'POST', body: { sql }, databaseId: id });
  const result = response.result?.[0];
  assert.ok(result?.success && Array.isArray(result.results), 'Consulta de recuperacao');
  return result.results;
};
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
let encrypted;
try {
  // Nenhuma exportacao ou restauracao de producao. O teste usa exclusivamente
  // o staging com dados ficticios e mantem o destino restaurado para inspecao.
  const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";
  const sourceSchema = await query(sourceId, schemaSql);
  const tables = sourceSchema.filter(row => row.type === 'table').map(row => row.name);
  assert.ok(tables.length > 40 && tables.every(name => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)), 'Inventario seguro de tabelas');
  const before = {};
  for (const table of tables) {
    const rows = await query(sourceId, 'SELECT * FROM "' + table + '"');
    before[table] = { count: rows.length, hash: digest(rows.map(row => JSON.stringify(row)).sort()) };
  }
  run('node_modules/wrangler/bin/wrangler.js', ['d1', 'time-travel', 'info', 'DB', '--config', 'wrangler.staging.jsonc']);
  console.log('Bookmark Time Travel staging disponivel (nao restaurado).');
  mkdirSync('backups', { recursive: true, mode: 0o700 });
  const prior = new Set(readdirSync('backups').filter(n => n.endsWith('.jdb')));
  run('scripts/backup.mjs', ['--remote', '--config', 'wrangler.staging.jsonc']);
  const created = readdirSync('backups').filter(n => n.endsWith('.jdb') && !prior.has(n));
  assert.equal(created.length, 1, 'Exatamente um backup cifrado de testes');
  encrypted = join('backups', created[0]);
  const bytes = readFileSync(encrypted);
  const manifest = JSON.parse(readFileSync(encrypted + '.manifest.json', 'utf8'));
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'), 'Integridade SHA256 do backup');
  const restoredSql = join(folder, 'restore.sql');
  run('scripts/decrypt-backup.mjs', [encrypted, restoredSql]);
  const importSql = join(folder, 'import.json');
  const prepared = spawnSync('python3', ['-B', 'scripts/prepare_d1_restore.py', restoredSql, importSql],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(prepared.status, 0, 'Preparacao das dependencias SQL da restauracao: ' + prepared.stderr.trim());
  const corrupted = Buffer.from(bytes); corrupted[corrupted.length-1] ^= 1;
  const damaged = join(folder, 'damaged.jdb'); writeFileSync(damaged, corrupted, { mode: 0o600 });
  const rejected = spawnSync(process.execPath, ['scripts/decrypt-backup.mjs', damaged, join(folder, 'invalid.sql')], { env, encoding: 'utf8', timeout: 60000 });
  assert.notEqual(rejected.status, 0, 'AES-GCM rejeita adulteracao');
  // Reutilizar somente destinos anteriores comprovadamente vazios. Nunca
  // apagar tabelas ou sobrescrever restauracoes completas/parciais.
  const previous = (await api('/d1/database?per_page=100')).result;
  let database;
  for (const candidate of previous || []) {
    if (!/^cr-jornada-staging-restore-[a-f0-9]{12}$/.test(candidate.name) ||
        candidate.uuid === sourceId || candidate.uuid === LIVE_D1_ID) continue;
    const tables = await query(candidate.uuid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
    if (!tables.length) { database = candidate; break; }
  }
  database ||= (await api('/d1/database', { method: 'POST', body: { name: restoreName } })).result;
  const destinationName = database.name;
  assert.ok(/^cr-jornada-staging-restore-[a-f0-9]{12}$/.test(destinationName) && database.uuid !== sourceId && database.uuid !== LIVE_D1_ID &&
    /^[0-9a-f-]{36}$/i.test(database.uuid), 'Novo destino de recuperacao separado');
  const detail = (await api('/d1/database/' + database.uuid)).result;
  assert.equal(detail.name, destinationName);
  const empty = await query(database.uuid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  assert.equal(empty.length, 0, 'Restauracao apenas em novo banco vazio');
  console.log('Destino vazio de recuperacao confirmado: ' + destinationName + ' (' + database.uuid + ').');
  const sections = JSON.parse(readFileSync(importSql, 'utf8'));
  assert.ok(Array.isArray(sections) && sections.length === 3 &&
    sections.every(part => Array.isArray(part) && part.every(sql => typeof sql === 'string' && Buffer.byteLength(sql) < 85000)), 'Instrucoes SQL limitadas ao tamanho seguro');
  for (const [index, statements] of sections.entries()) {
    // A API de query e usada em vez do importador bulk que reiniciou D1.
    // Tabelas primeiro; dados numa transacao com FKs diferidas; triggers por ultimo.
    let batch = [{ sql: 'PRAGMA defer_foreign_keys=TRUE;' }];
    let bytes = 0;
    const execute = async batch => {
      const restored = await api('/d1/database/' + database.uuid + '/query', {
        method: 'POST', body: { batch }, databaseId: database.uuid
      });
      assert.ok(Array.isArray(restored.result) && restored.result.every(r => r.success), 'Fase de recuperacao ' + index);
    };
    for (const statement of statements) {
      if (bytes + Buffer.byteLength(statement) > 90000 || batch.length >= 100) {
        await execute(batch); batch = [{ sql: 'PRAGMA defer_foreign_keys=TRUE;' }]; bytes = 0;
      }
      batch.push({ sql: statement }); bytes += Buffer.byteLength(statement);
    }
    if (statements.length) await execute(batch);
    console.log('Fase de recuperacao aprovada: ' + ['tabelas e indices','dados','triggers'][index]);
  }
  const restoredSchema = await query(database.uuid, schemaSql);
  assert.equal(digest(restoredSchema), digest(sourceSchema), 'Schema restaurado identico');
  for (const table of tables) {
    const rows = await query(database.uuid, 'SELECT * FROM "' + table + '"');
    assert.equal(rows.length, before[table].count, 'Contagem restaurada: ' + table);
    assert.equal(digest(rows.map(row => JSON.stringify(row)).sort()), before[table].hash, 'Conteudo restaurado: ' + table);
  }
  const check = await query(database.uuid, 'PRAGMA foreign_key_check');
  assert.equal(check.length, 0, 'Integridade referencial restaurada');
  const report = 'Recuperacao remota aprovada: ' + tables.length + ' tabelas, schema e hashes de conteudo identicos; SHA256/AES-256-GCM/adulteracao aprovados.\n' +
    'Origem: ' + STAGING_DATABASE + '; destino separado: ' + destinationName + ' (' + database.uuid + '). Producao nao exportada nem restaurada.\n';
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
} catch (error) {
  console.error('Recuperacao interrompida: ' + error.message);
  process.exitCode = 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
  // O arquivo foi gerado unicamente para prova de recuperacao; a chave e
  // efemera. Backups operacionais exigem cofre e retencao definidos pelo dono.
  if (encrypted) { rmSync(encrypted, { force: true }); rmSync(encrypted + '.manifest.json', { force: true }); }
}
