
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { employeeCpfAuthRoutes } from '../server/routes/employee-cpf-auth';

vi.mock('../server/core/security', () => ({
  ipHash: () => 'test-ip',
  limit: async () => undefined
}));
vi.mock('../server/core/crypto', () => ({
  keyedHash: () => '1'.repeat(64),
  hashPassword: async () => 'dummy',
  verifyPassword: async (password: string, hash: string) => password === hash,
  randomToken: () => 'a'.repeat(64),
  sha256: () => 'b'.repeat(64),
  safeEqual: (a: string, b: string) => a === b
}));

function makeApp() {
  const calls: string[] = [];
  const db = {
    prepare(sql: string) {
      calls.push(sql);
      const st = {
        bind(..._args: unknown[]) { return st; },
        async first() {
          if (sql.includes('FROM employee_login_challenges')) {
            return {
              choices_json: JSON.stringify([
                { company_id: 'company-a', employee_id: 'employee-a', user_id: 'user-a', auth_version: 1 },
                { company_id: 'company-b', employee_id: 'employee-b', user_id: 'user-b', auth_version: 1 }
              ])
            };
          }
          if (sql.includes('FROM employee_company_sessions s')) {
            return {
              user_id: 'user-a', employee_id: 'employee-a', company_id: 'company-a',
              company_name: 'Empresa A', company_slug: 'empresa-a',
              display_name: 'Funcionario A', csrf_token: 'csrf',
              token_hash: 'b'.repeat(64), expires_at: Date.now() + 60000,
              last_seen_at: Date.now(), must_change_password: 0
            };
          }
          return null;
        },
        async run() { return { success: true, meta: { changes: 1 } }; }
      };
      return st;
    },
    async batch(statements: unknown[]) {
      expect(statements).toHaveLength(2);
      return [
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } }
      ];
    }
  };
  const app = new Hono<App>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/employee/cpf-auth', employeeCpfAuthRoutes);
  app.onError((error, c) => error instanceof ApiError
    ? c.json({ error: { code: error.code } }, error.status as any)
    : c.json({ error: { code: 'internal_error' } }, 500));
  const env = {
    ENVIRONMENT: 'development',
    AUTH_PEPPER: 'test-only-pepper-32-characters-minimum',
    CPF_LOOKUP_SECRET: 'test-only-secret-32-characters-minimum'
  };
  const request = (path: string, method: 'GET' | 'POST', data?: object, cookie?: string, csrf?: string) =>
    app.request('/api/employee/cpf-auth' + path, {
      method,
      headers: {
        ...(data ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
      },
      ...(data ? { body: JSON.stringify(data) } : {})
    }, env as any);
  return { request, calls };
}

describe('CR JORNADA - sessao e selecao CPF', () => {
  it('nega selecao sem desafio', async () => {
    const t = makeApp();
    const r = await t.request('/select', 'POST', { company_id: 'company-a' });
    expect(r.status).toBe(401);
  });

  it('nega selecao de empresa nao autorizada', async () => {
    const t = makeApp();
    const r = await t.request('/select', 'POST',
      { company_id: 'company-c' }, 'cr_jornada_employee_choice_dev=' + 'a'.repeat(64));
    expect(r.status).toBe(403);
    expect(t.calls.some(sql => sql.includes('INSERT INTO employee_company_sessions')))
      .toBe(false);
  });

  it('troca desafio valido por sessao com UPDATE e INSERT atomicos', async () => {
    const t = makeApp();
    const r = await t.request('/select', 'POST',
      { company_id: 'company-b' }, 'cr_jornada_employee_choice_dev=' + 'a'.repeat(64));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, selection_required: false });
    expect(r.headers.get('set-cookie')).toContain('cr_jornada_employee_dev=');
    expect(t.calls.some(sql => sql.includes('UPDATE employee_login_challenges')))
      .toBe(true);
    expect(t.calls.some(sql => sql.includes('INSERT INTO employee_company_sessions')))
      .toBe(true);
  });

  it('retorna a empresa associada a sessao autenticada', async () => {
    const t = makeApp();
    const r = await t.request('/session', 'GET', undefined,
      'cr_jornada_employee_dev=' + 'a'.repeat(64));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      user: { employee_id: 'employee-a', role: 'employee' },
      company: { id: 'company-a', slug: 'empresa-a' },
      csrf_token: 'csrf'
    });
  });

  it('exige CSRF para encerrar sessao', async () => {
    const t = makeApp();
    const cookie = 'cr_jornada_employee_dev=' + 'a'.repeat(64);
    const blocked = await t.request('/logout', 'POST', {}, cookie);
    expect(blocked.status).toBe(403);
    const allowed = await t.request('/logout', 'POST', {}, cookie, 'csrf');
    expect(allowed.status).toBe(200);
    expect(t.calls.some(sql => sql.includes('DELETE FROM employee_company_sessions')))
      .toBe(true);
  });
});
