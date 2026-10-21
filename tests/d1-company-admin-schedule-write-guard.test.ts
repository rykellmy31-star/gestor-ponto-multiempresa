import { describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  VALID_COMPANY_ADMIN_WRITE_SQL,
  companyAdminWriteParams
} from '../server/core/company-admin-write-guard';

// Real SQLite/D1 engine, isolated in Miniflare. No remote database.
describe('CR JORNADA — revalidacao da sessao no INSERT D1 local', () => {
  it('aceita sessao legitima e bloqueia revogacao, troca de senha e cruzamento de empresa', async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({
      workers: [{
        name: 'test', modules: true,
        script: 'export default { fetch() { return new Response("test") } }',
        d1Databases: ['DB']
      }]
    }));
    try {
      const binding = await mf.getD1Database('DB');
      const db = binding.withSession() as unknown as D1DatabaseSession;
      const now = 1760000000000;
      await db.batch([
        db.prepare('CREATE TABLE company_admins(id TEXT PRIMARY KEY, company_id TEXT, active INTEGER, auth_version INTEGER, must_change_password INTEGER)'),
        db.prepare('CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY, admin_id TEXT, company_id TEXT, auth_version INTEGER, expires_at INTEGER, last_seen_at INTEGER)'),
        db.prepare('CREATE TABLE protected_writes(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)'),
        db.prepare("INSERT INTO company_admins VALUES ('admin-a','co-a',1,2,0),('admin-b','co-b',1,4,0)"),
        db.prepare('INSERT INTO company_admin_sessions VALUES (?,?,?,?,?,?)')
          .bind('token-a','admin-a','co-a',2,now + 600000,now - 1000),
        db.prepare('INSERT INTO company_admin_sessions VALUES (?,?,?,?,?,?)')
          .bind('token-b','admin-b','co-b',4,now + 600000,now - 1000)
      ]);
      const guardedWrite = async (
        id: string, token: string, admin: string, company: string,
        at = now
      ) => db.prepare(
        'INSERT INTO protected_writes(id,company_id) SELECT ?,? WHERE ' +
        VALID_COMPANY_ADMIN_WRITE_SQL
      ).bind(id, company,
        ...companyAdminWriteParams(token, admin, company, at)
      ).run();

      expect((await guardedWrite('valid-a', 'token-a', 'admin-a', 'co-a')).meta.changes).toBe(1);
      expect((await guardedWrite('cross-tenant', 'token-a', 'admin-a', 'co-b')).meta.changes).toBe(0);
      expect((await guardedWrite('wrong-admin', 'token-a', 'admin-b', 'co-a')).meta.changes).toBe(0);
      expect((await guardedWrite('wrong-token', 'token-b', 'admin-a', 'co-a')).meta.changes).toBe(0);
      expect((await guardedWrite('expired', 'token-a', 'admin-a', 'co-a', now + 600001)).meta.changes).toBe(0);
      expect((await guardedWrite('inactive-timeout', 'token-a', 'admin-a', 'co-a', now + 30 * 60000)).meta.changes).toBe(0);

      await db.prepare("UPDATE company_admins SET auth_version=auth_version+1 WHERE id='admin-a'").run();
      expect((await guardedWrite('password-reset', 'token-a', 'admin-a', 'co-a')).meta.changes).toBe(0);
      await db.prepare("UPDATE company_admins SET auth_version=2,must_change_password=1 WHERE id='admin-a'").run();
      expect((await guardedWrite('must-change-password', 'token-a', 'admin-a', 'co-a')).meta.changes).toBe(0);
      await db.prepare("UPDATE company_admins SET must_change_password=0,active=0 WHERE id='admin-a'").run();
      expect((await guardedWrite('suspended', 'token-a', 'admin-a', 'co-a')).meta.changes).toBe(0);
      await db.prepare("UPDATE company_admins SET active=1 WHERE id='admin-a'").run();
      await db.prepare("DELETE FROM company_admin_sessions WHERE token_hash='token-a'").run();
      expect((await guardedWrite('revoked', 'token-a', 'admin-a', 'co-a')).meta.changes).toBe(0);
      expect((await guardedWrite('valid-b', 'token-b', 'admin-b', 'co-b')).meta.changes).toBe(1);

      const writes = await db.prepare('SELECT id,company_id FROM protected_writes ORDER BY id').all();
      expect(writes.results).toEqual([
        { id: 'valid-a', company_id: 'co-a' },
        { id: 'valid-b', company_id: 'co-b' }
      ]);
    } finally {
      await mf.dispose();
    }
  }, 60000);
});
