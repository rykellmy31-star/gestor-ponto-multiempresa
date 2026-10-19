import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companySchedulesRoutes } from '../server/routes/company-schedules';

vi.mock('../server/core/security', () => ({
  ipHash: () => 'ip-test',
  limit: async () => undefined
}));
vi.mock('../server/core/crypto', () => ({
  sha256: () => 'b'.repeat(64),
  safeEqual: (a: string, b: string) => a === b
}));

type Mode = 'active' | 'anonymous' | 'invalid-target';
const schedule = {
  name: 'Turno comercial',
  start: '09:00', break_start: '12:00',
  break_end: '13:00', end: '18:00',
  weekdays: [1,2,3,4,5], paid_break: false
};

function makeApp(mode: Mode = 'active', flag = 'true') {
  const sqls: Array<{ sql: string; params: unknown[] }> = [];
  const batches: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const st = {
        bind(...args: unknown[]) { params = args; return st; },
        async first() {
          sqls.push({ sql, params: [...params] });
          if (!sql.includes('FROM company_admin_sessions s')) return null;
          if (mode === 'anonymous') return null;
          return {
            id: 'admin-a',
            company_id: 'company-a',
            slug: 'empresa-a',
            login: 'admin', display_name: 'Administrador',
            csrf_token: 'csrf-a',
            expires_at: Date.now() + 60000,
            last_seen_at: Date.now(),
            must_change_password: 0,
            token_hash: 'b'.repeat(64)
          };
        },
        async all() {
          sqls.push({ sql, params: [...params] });
          return { results: [
            { id: 'schedule-a', name: 'Horario A',
              config_json: JSON.stringify(schedule),
              created_at: Date.now() }
          ] };
        },
        async run() {
          sqls.push({ sql, params: [...params] });
          return { meta: { changes: 1 } };
        }
      };
      return st;
    },
    async batch(stmts: unknown[]) {
      batches.push(stmts);
      return [
        { meta: { changes: mode === 'invalid-target' ? 0 : 1 } },
        { meta: { changes: mode === 'invalid-target' ? 0 : 1 } }
      ];
    }
  };
  const app = new Hono<App>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/company/schedules', companySchedulesRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code } }, error.status as any);
    }
    return c.json({ error: { code: 'internal_error' } }, 500);
  });
  const env = {
    ENVIRONMENT: 'development',
    ENABLE_COMPANY_SCHEDULES: flag
  };
  function request(path: string, method: 'GET' | 'POST' = 'GET',
    body?: object, options: { csrf?: string; cookie?: boolean } = {}) {
    return app.request('/api/company/schedules' + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(options.cookie === false ? {} : {
          Cookie: 'cr_jornada_company_dev=' + 'a'.repeat(64)
        }),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }, env as any);
  }
  return { request, sqls, batches };
}

describe('CR JORNADA - administracao de jornadas por empresa', () => {
  it('bloqueia acesso antes da flag de liberacao', async () => {
    const t = makeApp('active', '');
    const result = await t.request('');
    expect(result.status).toBe(503);
    expect(t.sqls.some(x => x.sql.includes('FROM schedules s'))).toBe(false);
  });

  it('rejeita acesso sem sessao empresarial', async () => {
    const t = makeApp('anonymous');
    const result = await t.request('', 'GET', undefined, { cookie: false });
    expect(result.status).toBe(401);
  });

  it('lista apenas jornadas da empresa autenticada', async () => {
    const t = makeApp();
    const result = await t.request('');
    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.company_id).toBe('company-a');
    expect(data.schedules[0].id).toBe('schedule-a');
    const query = t.sqls.find(x => x.sql.includes('FROM schedules s'));
    expect(query?.params).toEqual(['company-a']);
    expect(query?.sql).toContain('s.company_id=?');
  });

  it('exige CSRF para criar jornadas', async () => {
    const t = makeApp();
    const denied = await t.request('', 'POST', schedule);
    expect(denied.status).toBe(403);
    expect(t.batches).toHaveLength(0);
  });

  it('cria jornada e auditoria em um batch atomico', async () => {
    const t = makeApp();
    const result = await t.request('', 'POST', schedule, { csrf: 'csrf-a' });
    expect(result.status).toBe(201);
    expect((await result.json()).company_id).toBe('company-a');
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(2);
  });

  it('bloqueia jornada invalida mesmo com sessao empresarial', async () => {
    const t = makeApp();
    const result = await t.request('', 'POST', {
      ...schedule, weekdays: [1, 1]
    }, { csrf: 'csrf-a' });
    expect(result.status).toBe(400);
    expect(t.batches).toHaveLength(0);
  });

  it('salva jornada com seg-sex agrupados e sabado independente', async () => {
    const t = makeApp();
    const result = await t.request('', 'POST', {
      ...schedule,
      weekdays:[1,2,3,4,5,6],
      day_overrides:{
        '6':{
          start:'07:00',break_start:'10:00',
          break_end:'10:15',end:'13:00',paid_break:true
        }
      }
    }, {csrf:'csrf-a'});
    expect(result.status).toBe(201);
    expect(t.batches).toHaveLength(1);
  });
  it('rejeita horario especial de dia nao trabalhado', async () => {
    const t=makeApp();
    const response=await t.request('', 'POST', {
      ...schedule,
      day_overrides:{
        '6':{
          start:'07:00',break_start:'10:00',
          break_end:'10:15',end:'13:00',paid_break:true
        }
      }
    }, {csrf:'csrf-a'});
    expect(response.status).toBe(422);
    expect(t.batches).toHaveLength(0);
  });

  it('atribui jornada somente se funcionario e escala sao da empresa', async () => {
    const t = makeApp();
    const result = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(result.status).toBe(201);
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(2);
  });

  it('rejeita atribuicao sem vinculo empresarial', async () => {
    const t = makeApp('invalid-target');
    const result = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-b', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(result.status).toBe(404);
  });
});
