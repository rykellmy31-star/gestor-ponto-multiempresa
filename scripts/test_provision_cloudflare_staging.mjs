import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingDatabase, assertStagingWrite, createClient, assertMigrationHistory } from './provision-cloudflare-staging.mjs';
import { CLOUDFLARE_ACCOUNT, STAGING_DATABASE, STAGING_WORKER } from './staging-guard.mjs';
import { LIVE_D1_ID, LIVE_WORKER } from './verify-production-target.mjs';
const id = '018b0f87-4bd3-4ec3-9852-e2566909ac24';

test('exige nome e ID separados do banco de producao', () => {
  assert.equal(validateStagingDatabase({ name: STAGING_DATABASE, uuid: id }), id);
  for (const uuid of [LIVE_D1_ID, LIVE_D1_ID.toUpperCase(), null, 'invalid']) {
    assert.throws(() => validateStagingDatabase({ name: STAGING_DATABASE, uuid }));
  }
  assert.throws(() => validateStagingDatabase({ name: 'cr-jornada-db', uuid: id }));
});

test('nenhuma escrita pode apontar para Worker ou D1 de producao', () => {
  for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) {
    for (const path of ['/workers/scripts/' + LIVE_WORKER + '/secrets', '/d1/database/' + LIVE_D1_ID + '/query', '/d1/database/' + id]) {
      assert.throws(() => assertStagingWrite(method, path, id));
    }
  }
  assertStagingWrite('POST', '/d1/database', id);
  assertStagingWrite('POST', '/d1/database/' + id + '/query', id);
  assertStagingWrite('PUT', '/workers/scripts/' + STAGING_WORKER + '/secrets', id);
});

test('erro remoto nao revela token, corpo nem detalhes sensiveis', async () => {
  const token = 'sensitive-marker-123456789';
  const api = createClient({ accountId: CLOUDFLARE_ACCOUNT, token,
    fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 9109, message: token }] }), { status: 403 }) });
  await assert.rejects(api('/workers/subdomain'), error => error.message.includes('HTTP 403') && !error.message.includes(token));
  assert.throws(() => createClient({ token, accountId: 'wrong' }));
});

test('404 comum nao e confundido com Worker ausente', async () => {
  const api = createClient({ accountId: CLOUDFLARE_ACCOUNT, token: 'example-test-token',
    fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 9109 }] }), { status: 404 }) });
  await assert.rejects(api('/workers/scripts/' + STAGING_WORKER + '/settings', { optionalWorker: true }));
});

test('historico parcial conhecido permitido; migracao desconhecida, repetida ou fora de ordem bloqueada', () => {
  const expected = ['0001_a.sql', '0002_b.sql'];
  assertMigrationHistory([], expected);
  assertMigrationHistory([{ name: expected[0] }], expected);
  for (const names of [['0000_unknown.sql'], [expected[1]], [expected[0], expected[0]]]) {
    assert.throws(() => assertMigrationHistory(names.map(name => ({ name })), expected));
  }
});
