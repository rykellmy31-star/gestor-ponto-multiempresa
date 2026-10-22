import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const LIVE_WORKER = 'gestor-ponto-multiempresa';
export const LIVE_ORIGIN = 'https://gestor-ponto-multiempresa.netssh3-0.workers.dev';
export const LIVE_D1_ID = '39045448-774c-4687-8bb9-26c7c3b2f963';
export const LIVE_D1_NAME = 'cr-jornada-db';

// Confirmed by remote read-only audit. No network calls or production writes.
// Production deployment remains separately blocked by scripts/preflight.mjs.
export function validateProductionTarget(config) {
  if (config?.name !== LIVE_WORKER || config?.vars?.APP_ORIGIN !== LIVE_ORIGIN) {
    throw new Error('CR JORNADA: Worker/origem nao correspondem ao alvo auditado.');
  }
  if (config?.vars?.ENVIRONMENT !== 'production') {
    throw new Error('CR JORNADA: ENVIRONMENT nao corresponde a production.');
  }
  const databases = config?.d1_databases;
  if (!Array.isArray(databases) || databases.length !== 1 ||
      databases[0].binding !== 'DB' ||
      databases[0].database_id !== LIVE_D1_ID ||
      databases[0].database_name !== LIVE_D1_NAME) {
    throw new Error('CR JORNADA: D1 nao corresponde ao banco de producao auditado.');
  }
  if (config?.assets?.run_worker_first !== true) {
    throw new Error('CR JORNADA: Worker precisa executar antes dos assets.');
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    validateProductionTarget(JSON.parse(readFileSync('wrangler.jsonc','utf8')));
    console.log('Destino verificado: Worker e D1 reais auditados, sem deploy.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Destino nao confirmado.');
    process.exitCode = 1;
  }
}
