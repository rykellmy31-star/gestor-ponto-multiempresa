import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateProductionTarget, LIVE_D1_ID, LIVE_D1_NAME,
  LIVE_WORKER, LIVE_ORIGIN
} from './verify-production-target.mjs';

const safe = {
  name: LIVE_WORKER,
  vars: { APP_ORIGIN: LIVE_ORIGIN, ENVIRONMENT: 'production' },
  d1_databases: [{ binding: 'DB', database_id: LIVE_D1_ID, database_name: LIVE_D1_NAME }],
  assets: { run_worker_first: true }
};

test('alvo do Worker e D1 corresponde ao inventario real auditado', () => {
  assert.equal(validateProductionTarget(safe), true);
  const actual = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.equal(validateProductionTarget(actual), true);
});

test('recusa novo Worker, origem errada ou banco nao autorizado', () => {
  for (const replacement of [
    { name: 'cr-jornada' },
    { vars: { ...safe.vars, APP_ORIGIN:'https://cr-jornada.netssh3-0.workers.dev' } },
    { vars: { ...safe.vars, ENVIRONMENT:'development' } },
    { d1_databases: [{...safe.d1_databases[0],database_id:'018b0f87-4bd3-4ec3-9852-e2566909ac24'}] },
    { d1_databases: [{...safe.d1_databases[0],database_name:'another-db'}] },
    { d1_databases: [...safe.d1_databases, safe.d1_databases[0]] },
    { assets: { run_worker_first:false } }
  ]) {
    assert.throws(() => validateProductionTarget({ ...safe,...replacement }), /CR JORNADA:/);
  }
});
