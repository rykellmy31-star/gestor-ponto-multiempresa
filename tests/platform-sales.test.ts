import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { platformSalesRoutes, salesPublicRoutes } from '../server/routes/platform-sales';
import { defaultSalesPage, salesPageSchema, whatsappUrl } from '../shared/sales-page';

vi.mock('../server/core/security', () => ({
  limit: async () => undefined
}));

function makeApp(options: {
  authenticated?: boolean;
  revision?: number;
  published?: boolean;
  changed?: number;
} = {}) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const config = { ...defaultSalesPage, whatsapp: '5573999999999' };
  const row = options.revision
    ? {
      config_json: JSON.stringify(config),
      published: options.published ? 1 : 0,
      revision: options.revision,
      updated_at: 1760000000000
    }
    : null;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) { args = values; return stmt; },
        async first() {
          calls.push({ sql, args });
          if (sql.includes('FROM sales_page_settings')) return row;
          if (sql.includes('FROM platform_sessions s')) {
            return options.authenticated === false ? null : {
              id: 'superadmin-1', login: 'superadmin',
              email: null, display_name: 'Administrador',
              csrf_token: 'csrf-token', expires_at: Date.now()+60000,
              last_seen_at: Date.now()
            };
          }
          return null;
        },
        async run() {
          calls.push({ sql, args });
          return { meta: { changes: options.changed ?? 1 } };
        }
      };
      return stmt;
    }
  };
  const app = new Hono<App>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/public', salesPublicRoutes);
  app.route('/api/platform/sales-page', platformSalesRoutes);
  app.onError((err, c) => err instanceof ApiError
    ? c.json({ error: { code: err.code, message: err.message } }, err.status as any)
    : c.json({ error: { code: 'internal_error' } }, 500));
  const env = { ENVIRONMENT: 'development' } as any;
  function get(path: string, cookie = true) {
    return app.request(path, { headers: cookie
      ? { cookie: 'cr_jornada_platform_dev='+'a'.repeat(64) } : {}
    }, env);
  }
  function save(data: object, csrf = 'csrf-token') {
    return app.request('/api/platform/sales-page', {
      method: 'PUT', headers: {
        'content-type': 'application/json',
        'X-CSRF-Token': csrf,
        cookie: 'cr_jornada_platform_dev='+'a'.repeat(64)
      },
      body: JSON.stringify(data)
    }, env);
  }
  return { get, save, calls, config };
}

describe('CR JORNADA - pagina de vendas', () => {
  it('inicia com valores sob consulta, sem numero real e sem link de compra inventado', () => {
    expect(salesPageSchema.safeParse(defaultSalesPage).success).toBe(true);
    expect(defaultSalesPage.whatsapp).toBe('');
    expect(defaultSalesPage.plans.every(p =>
      p.price === 'Sob consulta' && p.checkout_url === ''
    )).toBe(true);
  });

  it('gera URL HTTPS segura do WhatsApp e rejeita numero incompleto', () => {
    expect(whatsappUrl('5573999999999', 'Olá, CR JORNADA!'))
      .toContain('https://wa.me/5573999999999?text=');
    expect(whatsappUrl('73999999999', 'Oi')).toBe(null);
  });

  it('nao divulga rascunhos nem dados da configuracao ao publico', async () => {
    const t = makeApp({ revision: 3, published: false });
    const r = await t.get('/api/public/sales-page', false);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ published: false, config: null });
  });

  it('mostra somente os dados publicados', async () => {
    const t = makeApp({ revision: 4, published: true });
    const r = await t.get('/api/public/sales-page', false);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.published).toBe(true);
    expect(data.config.whatsapp).toBe('5573999999999');
    expect(data.revision).toBe(4);
    expect(JSON.stringify(data)).not.toContain('csrf-token');
  });

  it('exige sessao de Superadmin para ler configuracao', async () => {
    const t = makeApp({ authenticated: false });
    const r = await t.get('/api/platform/sales-page', false);
    expect(r.status).toBe(401);
    expect(t.calls.some(x=>x.sql.includes('FROM sales_page_settings'))).toBe(false);
  });

  it('retorna dados iniciais se o Superadmin ainda nao salvou nada', async () => {
    const t = makeApp();
    const r = await t.get('/api/platform/sales-page');
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.published).toBe(false);
    expect(data.revision).toBe(0);
    expect(data.config.headline).toBe(defaultSalesPage.headline);
  });

  it('exige CSRF antes de salvar no banco', async () => {
    const t = makeApp();
    const r = await t.save({
      config: t.config, published: true, expected_revision: 0
    }, 'errado');
    expect(r.status).toBe(403);
    expect(t.calls.some(x=>x.sql.includes('INSERT INTO sales_page_settings'))).toBe(false);
  });

  it('rejeita publicacao sem contato e sem checkout', async () => {
    const t = makeApp();
    const r = await t.save({
      config: defaultSalesPage, published: true, expected_revision: 0
    });
    expect(r.status).toBe(422);
  });

  it('grava e publica usando versao esperada e ID fixo', async () => {
    const t = makeApp({ revision: 3 });
    const r = await t.save({
      config: t.config, published: true, expected_revision: 3
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.revision).toBe(4);
    expect(data.published).toBe(true);
    const update = t.calls.find(x=>x.sql.includes('INSERT INTO sales_page_settings'));
    expect(update?.sql).toContain('WHERE sales_page_settings.revision=?');
    expect(update?.args.slice(-1)).toEqual([3]);
  });

  it('detecta conflito concorrente sem confirmar publicacao', async () => {
    const t = makeApp({ revision: 5, changed: 0 });
    const r = await t.save({
      config: t.config, published: true, expected_revision: 4
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('sales_page_conflict');
  });

  it('rejeita codigo HTML malicioso em URL e planos duplicados', () => {
    const invalidUrl = { ...defaultSalesPage,
      logo_url: 'javascript:alert(1)' };
    expect(salesPageSchema.safeParse(invalidUrl).success).toBe(false);
    const duplicate = { ...defaultSalesPage,
      plans: [defaultSalesPage.plans[0], defaultSalesPage.plans[0]] };
    expect(salesPageSchema.safeParse(duplicate).success).toBe(false);
  });
});
