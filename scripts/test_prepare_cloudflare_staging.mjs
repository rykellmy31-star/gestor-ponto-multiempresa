import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStagingConfig, parseArguments } from './prepare-cloudflare-staging.mjs';

const productionId = '39045448-774c-4687-8bb9-26c7c3b2f963';
const stagingId = '018b0f87-4bd3-4ec3-9852-e2566909ac24';
const production = {
  name: 'cr-jornada', main: 'server/index.ts', routes: [{ pattern: 'ponto.example.org', custom_domain: true }],
  assets: { directory: './public', run_worker_first: true, binding: 'ASSETS' },
  d1_databases: [{ binding: 'DB', database_name: 'cr-jornada-db', database_id: productionId, migrations_dir: 'migrations' }],
  triggers: { crons: ['0 4 * * *'] },
  vars: { ENVIRONMENT: 'production', APP_ORIGIN: 'https://ponto.example.org', ENABLE_EMPLOYEE_PUNCHES: 'true' }
};
const opts = {
  worker: 'cr-jornada-staging', database: 'cr-jornada-staging-db', databaseId: stagingId,
  origin: 'https://cr-jornada-staging.example.workers.dev'
};

describe('CR JORNADA — configuracao Cloudflare staging isolada', () => {
  it('gera staging separado sem mexer no banco, dominio ou config base', () => {
    const cloned = JSON.stringify(production);
    const result = createStagingConfig(production, opts);
    assert.equal(JSON.stringify(production), cloned);
    assert.equal(result.name, opts.worker);
    assert.equal(result.main, production.main);
    assert.equal(result.d1_databases[0].database_id, stagingId);
    assert.equal(result.d1_databases[0].binding, 'DB');
    assert.equal(result.vars.APP_ORIGIN, opts.origin);
    assert.equal(result.vars.ENVIRONMENT, 'production');
    assert.equal(result.assets.run_worker_first, true);
    assert.equal(Object.hasOwn(result, 'triggers'), false);
    assert.equal(Object.hasOwn(result, 'routes'), false);
    for (const key of ['ENABLE_COMPANY_SCHEDULES','ENABLE_COMPANY_EMPLOYEE_REGISTRATION',
      'ENABLE_EMPLOYEE_PASSWORD_RECOVERY','ENABLE_EMPLOYEE_PUNCHES','ENABLE_SALES_LEADS']) {
      assert.equal(result.vars[key], 'false');
    }
    assert.equal(JSON.stringify(result).includes('ponto.example.org'), false);
  });
  it('nao herda bindings, segredos, crons nem URLs adicionais da producao', () => {
    const unsafeProduction = {
      ...production,
      vars: {
        ...production.vars,
        SESSION_HOURS: '6',
        PROD_API_KEY: 'SEGREDO-SOMENTE-PRODUCAO',
        PAYMENT_GATEWAY_URL: 'https://checkout.prod.example'
      },
      account_id: 'conta-da-producao',
      routes: [{ pattern:'dominio-prod.example', custom_domain:true }],
      triggers: { crons:['* * * * *'] },
      kv_namespaces: [{ binding:'KV', id:'kv-prod-id' }],
      r2_buckets: [{ binding:'FILES', bucket_name:'prod-bucket' }],
      queues: { producers:[{ binding:'QUEUE', queue:'prod-jobs' }] },
      services: [{ binding:'BILLING', service:'billing-prod' }],
      unsafe: { bindings:[{ name:'SECRET', value:'danger' }] }
    };
    const staging = createStagingConfig(unsafeProduction, opts);
    assert.deepEqual(Object.keys(staging).sort(), [
      'assets','d1_databases','main','name','vars'
    ].sort());
    assert.deepEqual(Object.keys(staging.vars).sort(), [
      'APP_ORIGIN','ENVIRONMENT','SESSION_HOURS','ENABLE_COMPANY_SCHEDULES',
      'ENABLE_COMPANY_EMPLOYEE_REGISTRATION','ENABLE_EMPLOYEE_PASSWORD_RECOVERY',
      'ENABLE_EMPLOYEE_PUNCHES','ENABLE_SALES_LEADS'
    ].sort());
    assert.equal(staging.vars.SESSION_HOURS, '6');
    assert.equal(JSON.stringify(staging).includes('SEGREDO-SOMENTE-PRODUCAO'), false);
    assert.equal(JSON.stringify(staging).includes('checkout.prod.example'), false);
    assert.equal(JSON.stringify(staging).includes('prod-bucket'), false);
    assert.equal(JSON.stringify(staging).includes('prod-jobs'), false);
    assert.equal(JSON.stringify(staging).includes('billing-prod'), false);
    assert.equal(JSON.stringify(staging).includes('dominio-prod.example'), false);
    assert.equal(JSON.stringify(unsafeProduction.vars).includes('SEGREDO-SOMENTE-PRODUCAO'), true);
  });
  it('recusa banco da producao e URL de producao', () => {
    assert.throws(() => createStagingConfig(production, {...opts, databaseId: productionId}), /ID diferente/);
    assert.throws(() => createStagingConfig(production, {...opts, origin: production.vars.APP_ORIGIN}), /APP_ORIGIN/);
  });
  it('recusa nomes fora de staging e origens invalidas', () => {
    assert.throws(() => createStagingConfig(production, {...opts, worker: 'cr-jornada'}), /-staging/);
    assert.throws(() => createStagingConfig(production, {...opts, database:'cr-jornada-db'}), /-staging-db/);
    assert.throws(() => createStagingConfig(production, {...opts, origin:'http://example.com'}), /APP_ORIGIN/);
    assert.throws(() => createStagingConfig(production, {...opts, origin: opts.origin + '/'}), /APP_ORIGIN/);
    assert.throws(() => createStagingConfig(production, {...opts, databaseId:'fake-id'}), /UUID/);
  });
  it('exige parametros explicitos e validos', () => {
    assert.deepEqual(parseArguments(['--worker',opts.worker,'--database',opts.database,
      '--database-id',opts.databaseId,'--origin',opts.origin]),opts);
    assert.throws(() => parseArguments(['--worker',opts.worker]), /todos os parametros/);
    assert.throws(() => parseArguments(['--worker',opts.worker,'--worker',opts.worker]), /Uso:/);
  });
});
