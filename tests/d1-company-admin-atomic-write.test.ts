import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { companyAdminWrite } from '../server/core/company-admin-write';

describe('D1 local — rollback das credenciais empresariais', () => {
  it('conflito preserva senha, sessões e auditoria; sucesso afeta só o gestor alvo', async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({
      workers: [{ name: "test", modules: true,
      script: 'export default { fetch() { return new Response("local test") } }',
      d1Databases: ['DB'] }]
    }));
    try {
      const binding = await mf.getD1Database('DB');
      const db = binding.withSession() as unknown as D1DatabaseSession;
      await db.batch([
        db.prepare('CREATE TABLE managers(id TEXT PRIMARY KEY, version INTEGER, password TEXT)'),
        db.prepare('CREATE TABLE sessions(admin_id TEXT)'),
        db.prepare('CREATE TABLE events(admin_id TEXT)'),
        db.prepare(readFileSync('migrations/0026_company_admin_atomic_writes.sql', 'utf8')),
        db.prepare("INSERT INTO managers VALUES ('a',2,'original-a'),('b',0,'original-b')"),
        db.prepare("INSERT INTO sessions VALUES ('a'),('b')")
      ]);
      const mutation = (version: number) => companyAdminWrite(db, [
        db.prepare("UPDATE managers SET password='new-a',version=version+1 WHERE id='a' AND version=?").bind(version),
        db.prepare("DELETE FROM sessions WHERE admin_id='a'"),
        db.prepare("INSERT INTO events VALUES ('a')")
      ], 'password_change_conflict');
      await expect(mutation(1)).rejects.toMatchObject({status:409});
      expect((await db.prepare('SELECT * FROM managers ORDER BY id').all()).results)
        .toEqual([{id:'a',version:2,password:'original-a'}, {id:'b',version:0,password:'original-b'}]);
      expect((await db.prepare('SELECT * FROM sessions ORDER BY admin_id').all()).results)
        .toEqual([{admin_id:'a'},{admin_id:'b'}]);
      expect((await db.prepare('SELECT * FROM events').all()).results).toEqual([]);
      await mutation(2);
      expect((await db.prepare('SELECT * FROM sessions').all()).results).toEqual([{admin_id:'b'}]);
      expect((await db.prepare('SELECT * FROM events').all()).results).toEqual([{admin_id:'a'}]);
      expect((await db.prepare('SELECT * FROM company_admin_write_guards').all()).results).toEqual([]);
      // Falha depois da alteração também deve desfazer a própria senha.
      await expect(companyAdminWrite(db, [
        db.prepare("UPDATE managers SET password='should-rollback' WHERE id='a'"),
        db.prepare('INSERT INTO nonexistent_table VALUES (1)')
      ], 'conflict')).rejects.toThrow();
      expect(await db.prepare("SELECT password FROM managers WHERE id='a'").first())
        .toEqual({password:'new-a'});
    } finally {
      await mf.dispose();
    }
  }, 60000);
});
