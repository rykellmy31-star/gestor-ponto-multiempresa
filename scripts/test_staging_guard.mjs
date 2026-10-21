import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStagingConfig } from './prepare-cloudflare-staging.mjs';
import {
  assertStagingTarget, STAGING_WORKER, STAGING_DATABASE, STAGING_ORIGIN,
  CLOUDFLARE_ACCOUNT
} from './staging-guard.mjs';
import {
  LIVE_WORKER, LIVE_ORIGIN, LIVE_D1_ID, LIVE_D1_NAME
} from './verify-production-target.mjs';

const production = {
  name: LIVE_WORKER,
  main: 'server/index.ts',
  assets: { directory: './public', run_worker_first: true },
  vars: { APP_ORIGIN: LIVE_ORIGIN, ENVIRONMENT: 'production' },
  d1_databases: [{
    binding: 'DB', database_id: LIVE_D1_ID,
    database_name: LIVE_D1_NAME, migrations_dir: 'migrations'
  }]
};
const isolatedId = '018b0f87-4bd3-4ec3-9852-e2566909ac24';
const isolated = createStagingConfig(production, {
  worker: STAGING_WORKER, database: STAGING_DATABASE,
  databaseId: isolatedId, origin: STAGING_ORIGIN
});

test('configuracao de homologacao aponta somente para recursos separados', () => {
  assert.equal(assertStagingTarget(isolated, CLOUDFLARE_ACCOUNT, production), isolatedId);
  assert.notEqual(isolated.d1_databases[0].database_id, LIVE_D1_ID);
  assert.notEqual(isolated.name, LIVE_WORKER);
});

test('recusa mudar o nome do Worker para producao', () => {
  assert.throws(
    () => assertStagingTarget({ ...isolated, name: LIVE_WORKER }, CLOUDFLARE_ACCOUNT, production),
    /Destino staging/
  );
});

test('recusa reutilizacao do D1 de producao', () => {
  assert.throws(() => assertStagingTarget({
    ...isolated,
    d1_databases: [{ ...isolated.d1_databases[0], database_id: LIVE_D1_ID }]
  }, CLOUDFLARE_ACCOUNT, production), /Destino staging/);
});

test('recusa conta Cloudflare diferente', () => {
  assert.throws(
    () => assertStagingTarget(isolated, 'a'.repeat(32), production),
    /Conta Cloudflare/
  );
});

test('recusa crons, rotas, bindings extras e funcionalidades habilitadas', () => {
  const modifications = [
    { triggers: { crons: ['* * * * *'] } },
    { routes: [{ pattern: 'exemplo.invalid' }] },
    { kv_namespaces: [{ binding: 'KV', id: 'db-prod' }] },
    { queues: { producers: [{ binding: 'QUEUE', queue: 'fila-prod' }] } },
    { vars: { ...isolated.vars, ENABLE_EMPLOYEE_PUNCHES: 'true' } },
    { assets: { ...isolated.assets, run_worker_first: false } }
  ];
  for (const modification of modifications) {
    assert.throws(
      () => assertStagingTarget({ ...isolated, ...modification }, CLOUDFLARE_ACCOUNT, production),
      /Homologacao herdou/
    );
  }
});

test('falha se a configuracao base de producao for alterada indevidamente', () => {
  assert.throws(
    () => assertStagingTarget(isolated, CLOUDFLARE_ACCOUNT, {
      ...production,
      d1_databases: [{ ...production.d1_databases[0], database_id: isolatedId }]
    }),
    /D1 nao corresponde/
  );
});
