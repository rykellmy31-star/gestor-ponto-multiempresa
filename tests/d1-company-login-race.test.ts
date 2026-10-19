import { describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { hashPassword } from '../server/core/crypto';
import { ApiError } from '../server/core/errors';
import { companyAuthRoutes } from '../server/routes/company-auth';

describe('D1 local — login empresarial concorrente', () => {
  it('revalida suspensão, reset e expiração antes de emitir cookie', async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: 'export default {fetch(){return new Response("test")}}',
      d1Databases: ['DB']
    }));
    try {
      const binding = await mf.getD1Database('DB');
      const db = binding.withSession() as unknown as D1DatabaseSession;
      const pepper = 'test-pepper-for-local-d1-only';
      const password = 'SenhaLocalTeste2026';
      const hash = await hashPassword(password, pepper);
      await db.batch([
        db.prepare('CREATE TABLE companies(id TEXT PRIMARY KEY,slug TEXT,status TEXT)'),
        db.prepare('CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,password_hash TEXT,auth_version INTEGER,active INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER)'),
        db.prepare('CREATE TABLE company_admin_sessions(token_hash TEXT,company_id TEXT,admin_id TEXT,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)'),
        db.prepare("INSERT INTO companies VALUES ('co','empresa-teste','active')"),
        db.prepare("INSERT INTO company_admins VALUES ('adm','co','gestor',?,0,1,0,NULL)").bind(hash)
      ]);
      let race: string | null = null;
      const proxy = {
        prepare(sql: string) {
          const statement = db.prepare(sql);
          const wrapped = {
            bind(...args: any[]) { return wrap(statement.bind(...args)); }
          };
          function wrap(bound: D1PreparedStatement): any {
            return {
              bind(...args: any[]) { return wrap(bound.bind(...args)); },
              async first() {
                const result = await bound.first();
                if (race && sql.includes('FROM company_admins a')) {
                  await db.prepare(race).run();
                  race = null;
                }
                return result;
              },
              run: () => bound.run()
            };
          }
          return Object.assign(wrapped, wrap(statement));
        }
      };
      const app = new Hono<App>();
      app.use('*', async (c,next) => {
        c.set('db',proxy as unknown as D1DatabaseSession);
        await next();
      });
      app.route('/auth',companyAuthRoutes);
      app.onError((e,c) => e instanceof ApiError
        ? c.json({code:e.code},e.status as any) : c.json({code:'internal'},500));
      const login = () => app.request('/auth/login',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({company:'empresa-teste',login:'gestor',password})
      },{ENVIRONMENT:'development',AUTH_PEPPER:pepper} as any);
      for (const mutation of [
        "UPDATE companies SET status='suspended' WHERE id='co'",
        "UPDATE company_admins SET auth_version=1 WHERE id='adm'",
        "UPDATE company_admins SET active=0 WHERE id='adm'",
        "UPDATE company_admins SET password_hash='replaced' WHERE id='adm'",
        "UPDATE company_admins SET must_change_password=1,temporary_password_expires_at=1 WHERE id='adm'"
      ]) {
        await db.batch([
          db.prepare("UPDATE companies SET status='active'"),
          db.prepare('UPDATE company_admins SET password_hash=?,auth_version=0,active=1,must_change_password=0,temporary_password_expires_at=NULL').bind(hash)
        ]);
        race = mutation;
        const response = await login();
        expect(response.status,mutation).toBe(401);
        expect(response.headers.get('set-cookie')).toBeNull();
      }
      expect((await db.prepare('SELECT * FROM company_admin_sessions').all()).results).toEqual([]);
      await db.prepare('UPDATE company_admins SET must_change_password=0,temporary_password_expires_at=NULL').run();
      const success = await login();
      expect(success.status).toBe(200);
      expect(success.headers.get('set-cookie')).toContain('cr_jornada_company_dev=');
      expect((await db.prepare('SELECT admin_id,company_id FROM company_admin_sessions').all()).results)
        .toEqual([{admin_id:'adm',company_id:'co'}]);
    } finally { await mf.dispose(); }
  },60000);
});
