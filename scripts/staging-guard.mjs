import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  LIVE_WORKER, LIVE_ORIGIN, LIVE_D1_ID, LIVE_D1_NAME,
  validateProductionTarget
} from './verify-production-target.mjs';

export const STAGING_WORKER = 'gestor-ponto-multiempresa-staging';
export const STAGING_DATABASE = 'cr-jornada-staging-db';
export const STAGING_ORIGIN = 'https://gestor-ponto-multiempresa-staging.netssh3-0.workers.dev';
export const CLOUDFLARE_ACCOUNT = 'bd72cac5a83927b9fd935b34ad927dc7';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const disabled = [
  'ENABLE_COMPANY_SCHEDULES', 'ENABLE_COMPANY_EMPLOYEE_REGISTRATION',
  'ENABLE_EMPLOYEE_PASSWORD_RECOVERY', 'ENABLE_EMPLOYEE_PUNCHES',
  'ENABLE_SALES_LEADS'
];

export function assertStagingTarget(config, accountId, production) {
  if (accountId !== CLOUDFLARE_ACCOUNT) {
    throw new Error('Conta Cloudflare de homologacao nao autorizada.');
  }
  validateProductionTarget(production);
  const databases = config?.d1_databases;
  if (config?.name !== STAGING_WORKER ||
    config?.name === LIVE_WORKER ||
    config?.vars?.APP_ORIGIN !== STAGING_ORIGIN ||
    config?.vars?.APP_ORIGIN === LIVE_ORIGIN ||
    config?.vars?.ENVIRONMENT !== 'production' ||
    !Array.isArray(databases) || databases.length !== 1 ||
    databases[0].binding !== 'DB' ||
    databases[0].database_name !== STAGING_DATABASE ||
    databases[0].database_name === LIVE_D1_NAME ||
    !uuid.test(databases[0].database_id || '') ||
    databases[0].database_id.toLowerCase() === LIVE_D1_ID.toLowerCase()) {
    throw new Error('Destino staging invalido ou coincidente com producao.');
  }
  if (config?.assets?.run_worker_first !== true ||
    config?.routes !== undefined || config?.route !== undefined ||
    config?.triggers !== undefined || config?.kv_namespaces !== undefined ||
    config?.r2_buckets !== undefined || config?.queues !== undefined ||
    config?.services !== undefined || config?.unsafe !== undefined ||
    disabled.some(key => config.vars?.[key] !== 'false')) {
    throw new Error('Homologacao herdou vinculacoes ou funcoes proibidas.');
  }
  return databases[0].database_id;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const production = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
    const staging = JSON.parse(readFileSync('wrangler.staging.jsonc','utf8'));
    const id = assertStagingTarget(staging, process.env.CLOUDFLARE_ACCOUNT_ID, production);
    console.log('Configuracao staging validada, D1 distinto: ' + id.slice(0,8) + '…');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Validacao staging falhou.');
    process.exitCode = 1;
  }
}
