import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createStagingConfig(base, { worker, database, databaseId, origin }) {
  if (!/^[a-z][a-z0-9-]*-staging$/.test(worker ?? '')) {
    throw new Error('O nome do Worker deve terminar em -staging.');
  }
  if (!/^[a-z][a-z0-9-]*-staging-db$/.test(database ?? '')) {
    throw new Error('O nome do banco deve terminar em -staging-db.');
  }
  if (!uuidPattern.test(databaseId ?? '')) {
    throw new Error('Informe um Database ID D1 valido (UUID).');
  }
  const originalDb = base?.d1_databases?.find(db => db.binding === 'DB');
  if (!originalDb || typeof base?.main !== 'string' || !base?.assets?.directory) {
    throw new Error('A configuracao base precisa conter main, assets e a binding DB.');
  }
  if (databaseId.toLowerCase() === originalDb.database_id?.toLowerCase()) {
    throw new Error('O banco staging deve ter ID diferente do banco atual.');
  }
  let url;
  try { url = new URL(origin); } catch { throw new Error('APP_ORIGIN deve ser HTTPS valido.'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.hostname.endsWith('.invalid') ||
      url.username || url.password || origin === base.vars?.APP_ORIGIN) {
    throw new Error('APP_ORIGIN deve ser HTTPS, exclusivo do staging e sem caminho/barra final.');
  }
  const config = structuredClone(base);
  config.name = worker;
  config.d1_databases = [{ ...originalDb, database_name: database, database_id: databaseId }];
  // O staging usa os mesmos controles estritos de cookies e origem que a producao.
  config.vars = {
    ...config.vars,
    ENVIRONMENT: 'production',
    APP_ORIGIN: origin,
    ENABLE_COMPANY_SCHEDULES: 'false',
    ENABLE_COMPANY_EMPLOYEE_REGISTRATION: 'false',
    ENABLE_EMPLOYEE_PASSWORD_RECOVERY: 'false',
    ENABLE_EMPLOYEE_PUNCHES: 'false',
    ENABLE_SALES_LEADS: 'false'
  };
  // Nunca herdar o dominio de producao nem cron de manutencao da config principal.
  delete config.routes;
  delete config.route;
  delete config.workers_dev;
  delete config.triggers;
  return config;
}

export function parseArguments(args) {
  const options = {};
  const flags = new Map([
    ['--worker', 'worker'], ['--database', 'database'],
    ['--database-id', 'databaseId'], ['--origin', 'origin']
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const field = flags.get(args[i]);
    if (!field || !args[i + 1] || args[i + 1].startsWith('--') || options[field]) {
      throw new Error('Uso: npm run cloudflare:prepare-staging -- --worker NOME-staging --database NOME-staging-db --database-id UUID --origin https://URL');
    }
    options[field] = args[i + 1];
  }
  if (Object.keys(options).length !== flags.size) {
    throw new Error('Informe todos os parametros do Worker e D1 de staging.');
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const config = createStagingConfig(base, parseArguments(process.argv.slice(2)));
    writeFileSync('wrangler.staging.jsonc', JSON.stringify(config, null, 2) + '\n', {
      flag: 'wx', mode: 0o600
    });
    console.log('Config staging criada em wrangler.staging.jsonc. Nao foi feito deploy, criacao D1 nem alteracao de producao.');
  } catch (error) {
    console.error('Configuracao staging recusada: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
