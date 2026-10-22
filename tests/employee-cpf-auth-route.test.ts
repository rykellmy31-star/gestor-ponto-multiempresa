
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

type Candidate = {
  user_id: string;
  employee_id: string;
  company_id: string;
  company_name: string;
  company_status: string;
  employee_status: string;
  deleted_at: number | null;
  account_active: number;
  password_hash: string;
  auth_version: number;
};

const candidate = (company: string, password: string): Candidate => ({
  user_id: 'user-' + company,
  employee_id: 'employee-' + company,
  company_id: 'company-' + company,
  company_name: 'Empresa ' + company,
  company_status: 'active',
  employee_status: 'active',
  deleted_at: null,
  account_active: 1,
  password_hash: password,
  auth_version: 1
});

function setup(candidates: Candidate[]) {
  const sqls: string[] = [];
  const db = {
    prepare(sql: string) {
      sqls.push(sql);
      const statement = {
        bind(..._args: unknown[]) { return statement; },
        async all() { return { results: candidates, success: true }; },
        async first() { return null; },
        async run() { return { meta: { changes: 1 }, success: true }; }
      };
      return statement;
    }
  };
  const app = new Hono<App>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/employee/cpf-auth', employeeCpfAuthRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code } }, error.status as any);
    }
    return c.json({ error: { code: 'internal_error' } }, 500);
  });
  const env = {
    ENVIRONMENT: 'development',
    CPF_LOOKUP_SECRET: 'test-only-secret-32-characters-minimum',
    AUTH_PEPPER: 'test-only-pepper-32-characters-minimum',
    SESSION_HOURS: '8'
  };
  const login = (cpf: string, password: string) => app.request(
    '/api/employee/cpf-auth/login',
    { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cpf, password })
    },
    env as any
  );
  return { app, env, login, sqls };
}

describe('CR JORNADA - login CPF isolado de funcionarios', () => {
  it('autoriza uma unica empresa quando a senha corresponde', async () => {
    const t = setup([candidate('a', 'senha-a'), candidate('b', 'senha-b')]);
    const response = await t.login('529.982.247-25', 'senha-a');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, selection_required: false
    });
    expect(response.headers.get('set-cookie')).toContain('cr_jornada_employee_dev=');
    expect(t.sqls.some(sql => sql.includes('INSERT INTO employee_company_sessions')))
      .toBe(true);
    expect(t.sqls.some(sql => sql.includes('FROM employee_cpf_links l'))).toBe(true);
  });

  it('rejeita senha de outra empresa e CPF invalido sem criar sessao', async () => {
    const t = setup([candidate('a', 'senha-a')]);
    const wrong = await t.login('52998224725', 'senha-errada');
    expect(wrong.status).toBe(401);
    const invalid = await t.login('123.456.789-00', 'senha-a');
    expect(invalid.status).toBe(401);
    expect(t.sqls.some(sql => sql.includes('INSERT INTO employee_company_sessions')))
      .toBe(false);
  });

  it('pede selecao se duas empresas aceitam a mesma senha', async () => {
    const t = setup([candidate('a', 'senha-compartilhada'), candidate('b', 'senha-compartilhada')]);
    const response = await t.login('52998224725', 'senha-compartilhada');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, selection_required: true,
      companies: [
        { id: 'company-a', name: 'Empresa a' },
        { id: 'company-b', name: 'Empresa b' }
      ]
    });
    expect(response.headers.get('set-cookie')).toContain('cr_jornada_employee_choice_dev=');
    expect(t.sqls.some(sql => sql.includes('INSERT INTO employee_login_challenges')))
      .toBe(true);
    expect(t.sqls.some(sql => sql.includes('INSERT INTO employee_company_sessions')))
      .toBe(false);
  });

  it('nega conta empresarial desativada', async () => {
    const suspended = { ...candidate('a', 'senha-a'), company_status: 'suspended' };
    const t = setup([suspended]);
    const response = await t.login('52998224725', 'senha-a');
    expect(response.status).toBe(401);
    expect(t.sqls.some(sql => sql.includes('INSERT INTO employee_company_sessions')))
      .toBe(false);
  });

  it('nao tenta login quando segredo CPF nao esta configurado', async () => {
    const t = setup([]);
    const env = { ...t.env, CPF_LOOKUP_SECRET: '' };
    const response = await t.app.request('/api/employee/cpf-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cpf: '52998224725', password: 'senha' })
    }, env as any);
    expect(response.status).toBe(503);
  });
});
