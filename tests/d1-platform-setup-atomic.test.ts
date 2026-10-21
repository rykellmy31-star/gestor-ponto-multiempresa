import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { platformSetupRoutes } from '../server/routes/platform-setup';

describe('CR JORNADA — instalacao Superadmin atomica em D1 local', () => {
  it('reverte cadastro se auditoria falhar, depois cadastra uma vez', async () => {
    const mf=new Miniflare(convertV4MiniflareOptions({
      workers:[{name:'test',modules:true,
        script:'export default { fetch() { return new Response("ok") } }',
        d1Databases:['DB']}]
    }));
    try {
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession() as unknown as D1DatabaseSession;
      await db.batch([
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)'),
        db.prepare('CREATE TABLE platform_admins(id TEXT PRIMARY KEY,login TEXT UNIQUE COLLATE NOCASE,email TEXT,display_name TEXT,password_hash TEXT,active INTEGER,auth_version INTEGER,created_at INTEGER,updated_at INTEGER)'),
        db.prepare('CREATE TABLE platform_audit_log(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES platform_admins(id),action TEXT,entity_type TEXT,entity_id TEXT,details_json TEXT,created_at INTEGER)'),
        db.prepare("CREATE TRIGGER audit_failure BEFORE INSERT ON platform_audit_log BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END")
      ]);
      const app=new Hono<App>();
      app.use('*',async(c,next)=>{c.set('db',db);await next();});
      app.route('/api/platform',platformSetupRoutes);
      app.onError((error,c)=>error instanceof ApiError
        ?c.json({error:{code:error.code}},error.status as any)
        :c.json({error:{code:'internal_error'}},500));
      const env={
        AUTH_PEPPER:'pepper-superadmin-test-2026-staging-local',
        PLATFORM_BOOTSTRAP_TOKEN:'codigo-inicial-seguro-local-123456789',
        ENVIRONMENT:'development'
      } as any;
      const payload={
        token:env.PLATFORM_BOOTSTRAP_TOKEN,
        name:'Superadmin Local de Testes',
        login:'root-local',
        email:'',
        password:'NovaSenhaTeste!2026'
      };
      const call=()=>app.request('/api/platform/setup',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      },env);
      const fail=await call();
      expect(fail.status).toBe(500);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM platform_admins')
        .first<{total:number}>())?.total).toBe(0);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM platform_audit_log')
        .first<{total:number}>())?.total).toBe(0);
      await db.prepare('DROP TRIGGER audit_failure').run();
      const success=await call();
      expect(success.status).toBe(201);
      expect((await success.json() as any).success).toBe(true);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM platform_admins')
        .first<{total:number}>())?.total).toBe(1);
      const audit=await db.prepare('SELECT action,entity_type FROM platform_audit_log')
        .first<{action:string,entity_type:string}>();
      expect(audit).toMatchObject({
        action:'platform.setup_completed',entity_type:'platform_admin'
      });
      const duplicate=await call();
      expect(duplicate.status).toBe(410);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM platform_audit_log')
        .first<{total:number}>())?.total).toBe(1);
    } finally {
      await mf.dispose();
    }
  },120000);
});
