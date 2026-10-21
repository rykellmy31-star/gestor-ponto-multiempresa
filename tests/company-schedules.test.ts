import { jsonBody } from './helpers/json-body';
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

type Mode = 'active' | 'anonymous' | 'invalid-target' | 'assignment-replay' | 'assignment-conflict';
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
        sql,
        get params() { return [...params]; },
        bind(...args: unknown[]) { params = args; return st; },
        async first() {
          sqls.push({ sql, params: [...params] });
          if (sql.includes('SELECT id,full_name FROM employees')) {
            return params[0]==='employee-a' && params[1]==='company-a'
              ? {id:'employee-a',full_name:'João'} : null;
          }
          if (sql.includes('SELECT COALESCE(h.config_json,s.config_json)')) {
            return {
              config_json:JSON.stringify({
                start:'07:00',break_start:'11:00',break_end:'12:00',
                end:'16:00',paid_break:false,weekdays:[1,2,3,4,5],
                day_overrides:{
                  '2':{start:'13:00',break_start:'16:00',
                    break_end:'17:00',end:'22:00',paid_break:false}
                }
              }),
              assignment_id:'assigned-a'
            };
          }
          if (sql.includes('FROM schedule_assignments a')) {
            if (mode === 'assignment-replay') return {
              id: 'assignment-original', schedule_id: 'schedule-a'
            };
            if (mode === 'assignment-conflict') return {
              id: 'assignment-other', schedule_id: 'schedule-b'
            };
          }
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
        { meta: { changes: ['invalid-target','assignment-replay','assignment-conflict'].includes(mode) ? 0 : 1 } },
        { meta: { changes: ['invalid-target','assignment-replay','assignment-conflict'].includes(mode) ? 0 : 1 } }
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

  it('gestor visualiza João 07h segunda e 13h terça sem cruzar empresas', async () => {
    const t=makeApp();
    const response=await t.request('/employee/employee-a/week?from=2026-10-26');
    expect(response.status).toBe(200);
    const data=await jsonBody(response);
    expect(data.company_id).toBe('company-a');
    expect(data.employee_name).toBe('João');
    expect(data.days).toHaveLength(7);
    expect(data.days[0].shift.start).toBe('07:00');
    expect(data.days[1].shift.start).toBe('13:00');
    expect(data.days[5].shift).toBeNull();
    const lookups=t.sqls.filter(x=>x.sql.includes('SELECT COALESCE(h.config_json,s.config_json)'));
    expect(lookups).toHaveLength(7);
    expect(lookups[0].params).toEqual(['company-a','2026-10-26','employee-a','2026-10-26']);
  });

  it('não revela prévia de funcionário de outra empresa', async () => {
    const t=makeApp();
    const response=await t.request('/employee/employee-b/week?from=2026-10-26');
    expect(response.status).toBe(404);
    const queries=t.sqls.filter(x=>x.sql.includes('SELECT COALESCE(h.config_json,s.config_json)'));
    expect(queries).toHaveLength(0);
  });

  it('rejeita período malformado na prévia', async () => {
    const t=makeApp();
    const response=await t.request('/employee/employee-a/week?from=2026-02-30');
    expect(response.status).toBe(400);
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
    const data = await jsonBody(result);
    expect(data.company_id).toBe('company-a');
    expect(data.schedules[0].id).toBe('schedule-a');
    const query = t.sqls.find(x => x.sql.includes('FROM schedules s'));
    expect(query?.params).toEqual(['company-a']);
    expect(query?.sql).toContain('s.company_id=?');
    expect(query?.sql).toContain('s.deleted_at IS NULL');
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
    expect((await jsonBody(result)).company_id).toBe('company-a');
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(2);
    const insert = t.batches[0][0] as {sql:string;params:unknown[]};
    expect(insert.sql).toContain('cas.auth_version=ca.auth_version');
    expect(insert.sql).toContain('ca.active=1 AND ca.must_change_password=0');
    expect(insert.params).toContain('admin-a');
    expect(insert.params).toContain('company-a');
    expect(insert.params).toContain('b'.repeat(64));
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
  it('salva um turno diferente para terça sem alterar a segunda', async () => {
    const t=makeApp();
    const response=await t.request('', 'POST', {
      ...schedule,
      day_overrides:{
        '2':{start:'13:00',break_start:'16:00',
          break_end:'17:00',end:'22:00',paid_break:false}
      }
    },{csrf:'csrf-a'});
    expect(response.status).toBe(201);
    const insert=t.batches[0][0] as {params:unknown[]};
    expect(JSON.parse(insert.params[2] as string).day_overrides['2'].start)
      .toBe('13:00');
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

  it('impede atribuir jornada excluída logicamente na própria consulta SQL', async () => {
    const t = makeApp();
    const response = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(response.status).toBe(201);
    const firstStatement = t.batches[0][0] as { sql: string };
    expect(firstStatement.sql).toContain('s.company_id=e.company_id');
    expect(firstStatement.sql).toContain('s.deleted_at IS NULL');
    expect(firstStatement.sql).toContain('cas.auth_version=ca.auth_version');
    expect(firstStatement.sql).toContain('ca.active=1 AND ca.must_change_password=0');
  });

  it('repetição exata devolve confirmação sem nova auditoria', async () => {
    const t = makeApp('assignment-replay');
    const response = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toMatchObject({
      company_id: 'company-a', reused: true, success: true
    });
    expect(t.batches).toHaveLength(1);
    const insert = t.batches[0][0] as {sql:string;params:unknown[]};
    expect(insert.sql).toContain('NOT EXISTS (SELECT 1 FROM schedule_assignments existing');
    expect(insert.sql).toContain('cancelled.assignment_id=existing.id');
    expect(insert.params[6]).toBe('2026-11-02');
    const lookup = t.sqls.find(x => x.sql.includes('FROM schedule_assignments a'));
    expect(lookup?.params).toEqual(['employee-a', 'company-a', '2026-11-02']);
    expect(lookup?.sql).toContain('co.status=\'active\'');
  });

  it('repetição com jornada diferente preserva conflito 409', async () => {
    const t = makeApp('assignment-conflict');
    const response = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).error.code).toBe('schedule_date_conflict');
  });

  it('revalida a sessão do mesmo gestor e empresa na escrita', async () => {
    const t = makeApp();
    const response = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(response.status).toBe(201);
    const insert = t.batches[0][0] as {sql:string;params:unknown[]};
    expect(insert.sql).toContain('cas.token_hash=? AND cas.admin_id=? AND cas.company_id=?');
    expect(insert.sql).toContain('cas.expires_at>? AND cas.last_seen_at>?');
    const keyIndex = insert.params.indexOf('b'.repeat(64));
    expect(insert.params.slice(keyIndex, keyIndex+3)).toEqual([
      'b'.repeat(64), 'admin-a', 'company-a'
    ]);
    expect(typeof insert.params[keyIndex+3]).toBe('number');
    expect((insert.params[keyIndex+3] as number) -
      (insert.params[keyIndex+4] as number)).toBe(30*60000);
  });

  it('rejeita data inexistente antes de gravar atribuicao', async () => {
    const t = makeApp();
    const result = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-02-30'
    }, { csrf: 'csrf-a' });
    expect(result.status).toBe(400);
    expect(t.batches).toHaveLength(0);
  });

  it.each(['1899-12-31', '2101-01-01'])(
    'rejeita atribuição fora dos limites de datas: %s', async effective_from => {
      const t = makeApp();
      const response = await t.request('/schedule-a/assign', 'POST', {
        employee_id: 'employee-a', effective_from
      }, { csrf: 'csrf-a' });
      expect(response.status).toBe(400);
      expect(t.batches).toHaveLength(0);
    }
  );

  it('rejeita campos extras na atribuicao para impedir troca de empresa pelo cliente', async () => {
    const t = makeApp();
    const result = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-a', effective_from: '2026-11-02',
      company_id: 'company-b'
    }, { csrf: 'csrf-a' });
    expect(result.status).toBe(400);
    expect(t.batches).toHaveLength(0);
  });

  it('rejeita atribuicao sem vinculo empresarial', async () => {
    const t = makeApp('invalid-target');
    const result = await t.request('/schedule-a/assign', 'POST', {
      employee_id: 'employee-b', effective_from: '2026-11-02'
    }, { csrf: 'csrf-a' });
    expect(result.status).toBe(404);
  });
});
