import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { sha256 } from '../server/core/crypto';
import { platformSalesRoutes, salesPublicRoutes } from '../server/routes/platform-sales';
import { salesLeadAdminRoutes } from '../server/routes/sales-leads';
import { defaultSalesPage } from '../shared/sales-page';

describe('CR JORNADA — rotas comerciais com triggers reais de auditoria D1', () => {
  it('salva, publica, retira do ar e atualiza contato sem falso conflito apos commit', async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'test', modules: true,
      script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] }] }));
    try {
      const db = (await mf.getD1Database('DB')).withSession() as unknown as D1DatabaseSession;
      const token = 'a'.repeat(64), now = Date.now();
      await db.batch([
        db.prepare('CREATE TABLE platform_admins(must_change_password INTEGER NOT NULL DEFAULT 0,temporary_password_expires_at INTEGER,id TEXT PRIMARY KEY,login TEXT,email TEXT,display_name TEXT,active INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE platform_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,csrf_token TEXT,auth_version INTEGER,expires_at INTEGER,last_seen_at INTEGER)'),
        db.prepare('CREATE TABLE platform_audit_log(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,details_json TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)'),
        db.prepare("INSERT INTO platform_admins(id,login,email,display_name,active,auth_version) VALUES('qa','qa',NULL,'QA',1,1)"),
        db.prepare('INSERT INTO platform_sessions VALUES(?,?,?,1,?,?)').bind(sha256(token),'qa','csrf-qa',now+600000,now)
      ]);
      for (const file of ['0021_sales_page_settings.sql', '0022_sales_leads.sql']) {
        const source = readFileSync('migrations/' + file, 'utf8');
        const statements = source.match(/^CREATE TABLE[\s\S]*?\n\);|^CREATE TRIGGER[\s\S]*?\nEND;/gm) || [];
        expect(statements.length).toBeGreaterThan(1);
        await db.batch(statements.map(sql => db.prepare(sql)));
      }
      const app = new Hono<App>();
      app.use('*', async (c,next) => { c.set('db',db); await next(); });
      app.route('/api/platform/sales-page',platformSalesRoutes);
      app.route('/api/public',salesPublicRoutes);
      app.route('/api/platform/leads',salesLeadAdminRoutes);
      app.onError((error,c) => error instanceof ApiError
        ? c.json({error:{code:error.code}},error.status as any)
        : c.json({error:{code:'internal_error'}},500));
      const env = { ENVIRONMENT:'development', AUTH_PEPPER:'test-sales-trigger-pepper-only-2026' } as any;
      const call = (path:string, method='GET', body?:object) => app.request(path,{
        method, headers:{ Cookie:'cr_jornada_platform_dev='+token,
          'X-CSRF-Token':'csrf-qa','Content-Type':'application/json' },
        ...(body ? {body:JSON.stringify(body)} : {})
      },env);
      const config = { ...defaultSalesPage, plans:defaultSalesPage.plans.map(plan =>
        ({...plan,checkout_url:'https://example.invalid/qa'})) };
      expect((await call('/api/platform/sales-page','PUT',{
        config,published:false,expected_revision:0
      })).status).toBe(200);
      expect((await call('/api/public/sales-page')).status).toBe(200);
      expect(await (await call('/api/public/sales-page')).json()).toEqual({published:false,config:null});
      expect((await call('/api/platform/sales-page','PUT',{
        config,published:true,expected_revision:1
      })).status).toBe(200);
      expect((await (await call('/api/public/sales-page')).json() as any).published).toBe(true);
      expect((await call('/api/platform/sales-page','PUT',{
        config,published:true,expected_revision:1
      })).status).toBe(409);
      expect((await call('/api/platform/sales-page/unpublish','POST',{expected_revision:2})).status).toBe(200);
      expect((await call('/api/platform/sales-page/unpublish','POST',{expected_revision:2})).status).toBe(409);
      const lead = crypto.randomUUID();
      await db.prepare("INSERT INTO sales_leads(id,name,email,message,consent_at,created_at,updated_at) VALUES(?,'Cliente Ficticio','qa@example.test','Solicitacao ficticia',?,?,?)")
        .bind(lead,now,now,now).run();
      expect((await call('/api/platform/leads/'+lead,'PATCH',{status:'contacted'})).status).toBe(200);
      expect((await call('/api/platform/leads/'+crypto.randomUUID(),'PATCH',{status:'closed'})).status).toBe(404);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM platform_audit_log').first<{total:number}>())?.total).toBe(4);
    } finally { await mf.dispose(); }
  },60000);
});
