import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { employeeCpfHistoryRoutes } from '../server/routes/employee-cpf-history';

type Scenario = 'active' | 'anonymous' | 'must-change' | 'inactive';
type SqlCall = { sql: string; params: unknown[] };

function createApp(scenario: Scenario = 'active') {
  const calls: SqlCall[] = [];
  const now = Date.now();
  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { params = args; return statement; },
        async first() {
          calls.push({ sql, params: [...params] });
          if (scenario === 'anonymous' || scenario === 'inactive') return null;
          return {
            user_id: 'user-a', employee_id: 'employee-a',
            company_id: 'company-a', company_name: 'Empresa A',
            company_slug: 'empresa-a', display_name: 'Funcionario A',
            csrf_token: 'csrf',
            token_hash: params[0],
            last_seen_at: now,
            expires_at: now + 60000,
            must_change_password: scenario === 'must-change' ? 1 : 0
          };
        },
        async all() {
          calls.push({ sql, params: [...params] });
          if (!sql.includes('JOIN work_days d')) {
            throw new Error('Query inesperada');
          }
          if (params[3] !== 'employee-a' || params[4] !== 'company-a') {
            throw new Error('Consulta sem identidade de sessao');
          }
          return {
            success: true,
            results: [
              { work_date: '2026-10-10', next_seq: 2,
                punch_id: 'p-1', seq: 0, type: 'entry',
                recorded_at: 1791644400000 },
              { work_date: '2026-10-10', next_seq: 2,
                punch_id: 'p-2', seq: 1, type: 'break_start',
                recorded_at: 1791658800000 },
              { work_date: '2026-10-11', next_seq: 0,
                punch_id: null, seq: null, type: null,
                recorded_at: null }
            ]
          };
        },
        async run() { calls.push({ sql, params: [...params] }); return { success: true }; }
      };
      return statement;
    }
  };
  const app = new Hono<App>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/employee/cpf-work', employeeCpfHistoryRoutes);
  app.onError((error, c) => error instanceof ApiError
    ? c.json({ error: { code: error.code } }, error.status as any)
    : c.json({ error: { code: 'internal_error' } }, 500)
  );

  async function request(path = '/history?month=2026-10', authenticated = true) {
    return app.request('/api/employee/cpf-work' + path, {
      method: 'GET',
      headers: authenticated
        ? { Cookie: 'cr_jornada_employee_dev=' + 'a'.repeat(64) }
        : {}
    }, { ENVIRONMENT: 'development' } as any);
  }
  return { request, calls };
}

describe('CR JORNADA - historico de ponto isolado no CPF', () => {
  it('lista somente dados associados a empresa e funcionario da sessao', async () => {
    const t = createApp();
    const response = await t.request('/history?month=2026-10&company_id=company-b&employee_id=employee-b');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const data = await response.json();
    expect(data.company_id).toBe('company-a');
    expect(data.employee_id).toBe('employee-a');
    expect(data.days).toHaveLength(2);
    expect(data.days[0].punches).toHaveLength(2);
    expect(data.days[1].punches).toEqual([]);
    const sql = t.calls.find(call => call.sql.includes('JOIN work_days d'));
    expect(sql).toBeDefined();
    expect(sql?.sql).toContain('e.company_id = ?');
    expect(sql?.sql).toContain('d.company_id = e.company_id');
    expect(sql?.sql).toContain('p.employee_id = e.id');
    expect(sql?.sql).toContain("co.status = 'active'");
    expect(sql?.params.slice(3)).toEqual([
      'employee-a', 'company-a', '2026-10-01', '2026-11-01'
    ]);
    expect(JSON.stringify(data)).not.toContain('ip_hash');
    expect(JSON.stringify(data)).not.toContain('idempotency_key');
  });

  it('recusa acesso sem sessao CPF', async () => {
    const t = createApp('anonymous');
    const response = await t.request('/history?month=2026-10', false);
    expect(response.status).toBe(401);
    expect(t.calls.some(call => call.sql.includes('JOIN work_days d'))).toBe(false);
  });

  it('recusa sessao inativa ou revogada', async () => {
    const t = createApp('inactive');
    expect((await t.request()).status).toBe(401);
  });

  it('exige troca de senha inicial antes de expor os registros', async () => {
    const t = createApp('must-change');
    const response = await t.request();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('password_change_required');
    expect(t.calls.some(call => call.sql.includes('JOIN work_days d'))).toBe(false);
  });

  it('rejeita mes ausente, invalido ou injetado, sem buscar historico', async () => {
    const t = createApp();
    for (const path of [
      '/history', '/history?month=2026-00',
      '/history?month=2026-13',
      '/history?month=2026-10%27%20OR%201%3D1'
    ]) {
      const response = await t.request(path);
      expect(response.status).toBe(400);
    }
    expect(t.calls.some(call => call.sql.includes('JOIN work_days d'))).toBe(false);
  });

  it('monta intervalo correto para dezembro', async () => {
    const t = createApp();
    const response = await t.request('/history?month=2026-12');
    expect(response.status).toBe(200);
    const sql = t.calls.find(call => call.sql.includes('JOIN work_days d'));
    expect(sql?.params.slice(-2)).toEqual(['2026-12-01', '2027-01-01']);
  });
});
