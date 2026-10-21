import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createStagingConfig } from './prepare-cloudflare-staging.mjs';
import { assertStagingTarget, STAGING_WORKER, STAGING_DATABASE, STAGING_ORIGIN,
  CLOUDFLARE_ACCOUNT } from './staging-guard.mjs';
import { validateProductionTarget, LIVE_D1_ID, LIVE_WORKER, LIVE_D1_NAME } from './verify-production-target.mjs';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function validateStagingDatabase(database) {
  if (database?.name !== STAGING_DATABASE || !uuid.test(database?.uuid || '') ||
      database.uuid.toLowerCase() === LIVE_D1_ID.toLowerCase()) {
    throw new Error('D1 staging nao confirmado; operacao remota bloqueada.');
  }
  return database.uuid;
}

// A lista de escrita nunca inclui recursos de producao nem exclusoes.
export function assertStagingWrite(method, path, databaseId) {
  if (method === 'POST' && path === '/d1/database') return;
  const validId = uuid.test(databaseId || '') && databaseId.toLowerCase() !== LIVE_D1_ID.toLowerCase();
  if (validId && method === 'POST' && path === '/d1/database/' + databaseId + '/query') return;
  if (method === 'PUT' && path === '/workers/scripts/' + STAGING_WORKER + '/secrets') return;
  throw new Error('Escrita Cloudflare fora do staging bloqueada.');
}

export function createClient({ token, accountId, fetchImpl = fetch }) {
  if (accountId !== CLOUDFLARE_ACCOUNT || typeof token !== 'string' || token.length < 10) {
    throw new Error('Conta incorreta ou CLOUDFLARE_STAGING_TOKEN ausente.');
  }
  return async (path, { method = 'GET', body, databaseId, optionalWorker = false } = {}) => {
    if (!path.startsWith('/') || path.includes('..') || path.includes('#')) throw new Error('Caminho invalido.');
    if (method !== 'GET') assertStagingWrite(method, path, databaseId);
    const response = await fetchImpl('https://api.cloudflare.com/client/v4/accounts/' + accountId + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => null);
    if (optionalWorker && response.status === 404 && data?.errors?.some(e => e.code === 10007)) return null;
    if (!response.ok || !data?.success) {
      const code = data?.errors?.[0]?.code;
      throw new Error('Cloudflare ' + method + ' ' + path.split('?')[0] + ': HTTP ' + response.status +
        ' (codigo ' + (Number.isSafeInteger(code) ? code : 'indisponivel') + ').');
    }
    return data;
  };
}

export function assertMigrationHistory(rows, expected) {
  const actual = rows.map(row => row.name);
  if (new Set(actual).size !== actual.length || actual.some(name => !expected.includes(name))) {
    throw new Error('Historico de migrations staging desconhecido.');
  }
  if (actual.some((name, i) => name !== expected[i])) throw new Error('Migrations staging fora de sequencia.');
}

export async function provisionStaging() {
  process.umask(0o077);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const api = createClient({ token: process.env.CLOUDFLARE_STAGING_TOKEN, accountId });
  const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  validateProductionTarget(base);
  // Verificar identificadores reais antes de qualquer escrita. Somente metadados.
  const live = (await api('/d1/database/' + LIVE_D1_ID)).result;
  if (live?.uuid !== LIVE_D1_ID || live?.name !== LIVE_D1_NAME) throw new Error('Producao nao identificada.');
  const liveSettings = (await api('/workers/scripts/' + LIVE_WORKER + '/settings')).result;
  if (!liveSettings?.bindings?.some(b => b.type === 'd1' && b.name === 'DB' &&
      (b.id || b.database_id) === LIVE_D1_ID)) throw new Error('Binding de producao nao confirmado.');
  const subdomain = (await api('/workers/subdomain')).result?.subdomain;
  if (subdomain !== 'netssh3-0') throw new Error('Subdominio Cloudflare inesperado.');
  console.log('Token staging autenticado; conta, Worker e D1 de producao identificados sem alteracoes.');

  const listed = await api('/d1/database?name=' + STAGING_DATABASE + '&per_page=100');
  const matches = listed.result?.filter(d => d.name === STAGING_DATABASE);
  if (!Array.isArray(matches) || matches.length > 1 || Number(listed.result_info?.total_pages || 1) > 1) {
    throw new Error('Inventario D1 ambiguo.');
  }
  const workerPath = '/workers/scripts/' + STAGING_WORKER;
  const existingWorker = await api(workerPath + '/settings', { optionalWorker: true });
  if (existingWorker && matches.length === 0) throw new Error('Worker existente sem D1 staging confirmado.');
  const database = matches[0] || (await api('/d1/database', {
    method: 'POST', body: { name: STAGING_DATABASE }
  })).result;
  const databaseId = validateStagingDatabase(database);
  validateStagingDatabase((await api('/d1/database/' + databaseId)).result);
  if (existingWorker && !existingWorker.result?.bindings?.some(b => b.type === 'd1' &&
      b.name === 'DB' && (b.id || b.database_id) === databaseId)) {
    throw new Error('Worker staging vinculado a outro D1; reconfiguracao automatica recusada.');
  }
  const config = createStagingConfig(base, { worker: STAGING_WORKER, database: STAGING_DATABASE,
    databaseId, origin: STAGING_ORIGIN });
  assertStagingTarget(config, accountId, base);
  writeFileSync('wrangler.staging.jsonc', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });

  const query = async sql => {
    // Este helper e restrito a leitura. Migrations sao executadas pelo Wrangler guardado.
    if (!sql.startsWith('SELECT ')) throw new Error('Consulta de verificacao invalida.');
    const result = await api('/d1/database/' + databaseId + '/query', {
      method: 'POST', body: { sql }, databaseId
    });
    const first = result.result?.[0];
    if (!first?.success || !Array.isArray(first.results) || first.meta?.changed_db === true ||
        Number(first.meta?.rows_written || 0) > 0) throw new Error('Leitura D1 staging invalida.');
    return first.results;
  };
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  const migrations = readdirSync('migrations').filter(n => n.endsWith('.sql')).sort();
  if (migrations.length !== 38) throw new Error('Inventario de migrations mudou; revisao necessaria.');
  if (tables.some(t => t.name === 'd1_migrations')) {
    assertMigrationHistory(await query('SELECT name FROM d1_migrations ORDER BY id'), migrations);
  } else if (tables.length) throw new Error('Banco staging contem schema desconhecido.');
  const run = args => {
    assertStagingTarget(JSON.parse(readFileSync('wrangler.staging.jsonc', 'utf8')), accountId, base);
    const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
      encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_STAGING_TOKEN,
        WRANGLER_SEND_METRICS: 'false', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    // Wrangler pode conter metadados; nao copiar saida bruta ao CI publico.
    if (result.status !== 0) throw new Error('Wrangler staging falhou na etapa ' + args.slice(0, 2).join(' ') + '; nenhuma saida sensivel foi publicada.');
  };
  run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.staging.jsonc']);
  const history = await query('SELECT name FROM d1_migrations ORDER BY id');
  assertMigrationHistory(history, migrations);
  if (history.length !== migrations.length) throw new Error('Migrations incompletas.');
  console.log('D1 staging confirmado: ' + databaseId + '; 38 migrations aplicadas.');
  run(['deploy', '--config', 'wrangler.staging.jsonc']);
  const settings = (await api(workerPath + '/settings')).result;
  if (!settings?.bindings?.some(b => b.type === 'd1' && b.name === 'DB' &&
      (b.id || b.database_id) === databaseId)) throw new Error('Binding remoto staging incorreto.');
  const names = (await api(workerPath + '/secrets')).result?.map(s => s.name);
  if (!Array.isArray(names)) throw new Error('Lista de secrets invalida.');
  const missing = ['AUTH_PEPPER', 'DATA_KEY', 'CPF_LOOKUP_SECRET'].filter(n => !names.includes(n));
  if (missing.length && existingWorker) throw new Error('Worker preexistente sem secrets completos; rotacao automatica recusada.');
  for (const name of missing) {
    const secret = randomBytes(32).toString('hex');
    console.log('::add-mask::' + secret);
    await api(workerPath + '/secrets', { method: 'PUT', body: { name, text: secret, type: 'secret_text' } });
  }
  const publicState = (await api(workerPath + '/subdomain')).result;
  if (publicState?.enabled !== true) throw new Error('URL workers.dev staging nao habilitada.');
  let healthy = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 5000));
    const response = await fetch(STAGING_ORIGIN + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(20000) });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.status === 'ok' && body?.database === 'D1' &&
        response.headers.get('x-content-type-options') === 'nosniff' &&
        response.headers.get('strict-transport-security')?.includes('max-age=')) { healthy = true; break; }
  }
  if (!healthy) throw new Error('Health check HTTPS staging nao aprovado.');
  const report = 'Staging real publicado: ' + STAGING_ORIGIN + '\nD1 exclusivo: ' + databaseId +
    '\n38 migrations; HTTPS/health/headers aprovados. Funcionalidades em auditoria continuam desligadas.\n';
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  provisionStaging().catch(error => { console.error(error.message); process.exitCode = 1; });
}
