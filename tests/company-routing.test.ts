import { jsonBody } from './helpers/json-body';

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';

// Simula os servicos de seguranca sem alterar
// a autenticacao implementada no projeto.
vi.mock('../server/core/security', () => ({
  ipHash: () => 'test-ip',
  limit: async () => undefined,
  auth: () => async (_c: any, next: any) => next(),
  getPrincipal: async () => null,
  originGuard: async (_c: any, next: any) => next()
}));

vi.mock('../server/core/crypto', () => ({
  hashPassword: async () => 'dummy-hash',
  verifyPassword: async () => true,
  randomToken: () => 'a'.repeat(64),
  sha256: () => 'token-hash',
  safeEqual: (a: string, b: string) => a === b
}));

import server from '../server/index';

type Scenario = 'company-a' | 'company-b' | 'anonymous';

const employees = [
  {
    id: 'employee-a',
    company_id: 'company-a',
    full_name: 'Funcionario da Empresa A',
    registration: 'A001',
    job_title: 'Atendente',
    admission_date: '2026-01-01',
    employment_end: null,
    status: 'active',
    cpf_last4: null,
    deleted_at: null
  },
  {
    id: 'employee-b',
    company_id: 'company-b',
    full_name: 'Funcionario da Empresa B',
    registration: 'B001',
    job_title: 'Entregador',
    admission_date: '2026-01-01',
    employment_end: null,
    status: 'active',
    cpf_last4: null,
    deleted_at: null
  }
];

function makeEnvironment(scenario: Scenario, registrationFlag?: string) {
  const statements: string[] = [];

  const db = {
    withSession() {
      return {
        prepare(sql: string) {
          let parameters: unknown[] = [];

          const statement = {
            bind(...args: unknown[]) {
              parameters = args;
              return statement;
            },

            async first() {
              statements.push(sql);

              if (/FROM\s+company_admin_sessions\s+s/i.test(sql)) {
                if (scenario === 'anonymous') {
                  return null;
                }

                const companyId =
                  scenario === 'company-a'
                    ? 'company-a'
                    : 'company-b';

                return {
                  id: `admin-${companyId}`,
                  company_id: companyId,
                  login: 'gestor',
                  display_name: 'Gestor',
                  csrf_token: 'csrf-token',
                  expires_at: Date.now() + 60000,
                  last_seen_at: Date.now(),
                  token_hash: 'token-hash',
                  must_change_password: 0,
                  slug: scenario
                };
              }

              return null;
            },

            async all() {
              statements.push(sql);

              if (!/FROM\s+employees\b/i.test(sql)) {
                return { results: [] };
              }

              // Impede que o teste aceite uma consulta
              // que nao tenha filtro por empresa.
              if (!/WHERE\s+company_id\s*=\s*\?/i.test(sql)) {
                throw new Error(
                  'Consulta sem isolamento empresarial.'
                );
              }

              const companyId = parameters[0];

              return {
                results: employees
                  .filter(employee =>
                    employee.company_id === companyId &&
                    employee.deleted_at === null
                  )
                  .map(({
                    company_id,
                    deleted_at,
                    ...employee
                  }) => employee)
              };
            },

            async run() {
              statements.push(sql);
              return { success: true };
            }
          };

          return statement;
        }
      };
    }
  };

  const env = {
    DB: db,
    ENVIRONMENT: 'development',
    APP_ORIGIN: 'http://localhost',
    AUTH_PEPPER: 'test-pepper'.repeat(5),
    DATA_KEY: 'a'.repeat(64),
    SESSION_HOURS: '8',
    ENABLE_COMPANY_EMPLOYEE_REGISTRATION: registrationFlag,
    ASSETS: {
      fetch: async () => new Response('asset')
    }
  };

  const request = (
    path: string,
    method = 'GET',
    authenticated = true,
    csrf?: string
  ) =>
    server.request(
      path,
      {
        method,
        headers: authenticated
          ? {
              Cookie:
                'cr_jornada_company_dev=' + 'a'.repeat(64),
              ...(csrf ? { 'X-CSRF-Token': csrf } : {})
            }
          : {}
      },
      env as any
    );

  return {
    request,
    statements
  };
}

describe('CR JORNADA - protecao das rotas', () => {
  it('cadastro explicitamente habilitado chega ao modulo seguro sem pular autenticacao ou CSRF', async () => {
    const anonymous = makeEnvironment('anonymous', 'true');
    expect((await anonymous.request('/api/company/employees', 'POST')).status).toBe(401);
    for (const scenario of ['company-a', 'company-b'] as const) {
      const t = makeEnvironment(scenario, 'true');
      expect((await t.request('/api/company/employees', 'POST')).status).toBe(403);
      const response = await t.request('/api/company/employees', 'POST', true, 'csrf-token');
      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe('invalid_employee');
      expect(t.statements.some(sql => /INSERT\s+INTO\s+employees/i.test(sql))).toBe(false);
    }
    const wrongFlag = makeEnvironment('company-a', 'TRUE');
    const blocked = await wrongFlag.request('/api/company/employees', 'POST');
    expect(blocked.status).toBe(503);
    expect((await jsonBody(blocked)).error.code).toBe('tenant_isolation_pending');
  });

  it('empresa A acessa somente seus funcionarios', async () => {
    const t = makeEnvironment('company-a');

    const response = await t.request(
      '/api/company/employees'
    );

    expect(response.status).toBe(200);

    const data = await jsonBody(response);

    expect(data.company_id).toBe('company-a');
    expect(data.employees).toHaveLength(1);
    expect(data.employees[0].id).toBe('employee-a');
  });

  it('empresa B acessa somente seus funcionarios', async () => {
    const t = makeEnvironment('company-b');

    const response = await t.request(
      '/api/company/employees'
    );

    expect(response.status).toBe(200);

    const data = await jsonBody(response);

    expect(data.company_id).toBe('company-b');
    expect(data.employees).toHaveLength(1);
    expect(data.employees[0].id).toBe('employee-b');
  });

  it('nega listagem sem autenticacao empresarial', async () => {
    const t = makeEnvironment('anonymous');

    const response = await t.request(
      '/api/company/employees',
      'GET',
      false
    );

    expect(response.status).toBe(401);

    expect(
      t.statements.some(sql =>
        /FROM\s+employees\b/i.test(sql)
      )
    ).toBe(false);
  });

  it('mantem rota antiga de ponto bloqueada', async () => {
    const t = makeEnvironment('company-a');

    const response = await t.request(
      '/api/employee/punch',
      'POST'
    );

    expect(response.status).toBe(503);

    const data = await jsonBody(response);

    expect(data.error.code)
      .toBe('tenant_isolation_pending');
  });

  it('mantem rotas administrativas antigas bloqueadas', async () => {
    const t = makeEnvironment('company-a');

    const response = await t.request(
      '/api/admin/employees'
    );

    expect(response.status).toBe(503);
  });

  it('recuperação nova exige sessão e não abre o cadastro legado', async()=>{
    const anonymous=makeEnvironment('anonymous');
    expect((await anonymous.request('/api/company/employees/employee-a/reset-password','POST')).status).toBe(401);
    const authenticated=makeEnvironment('company-a');
    expect((await authenticated.request('/api/company/employees/employee-a/reset-password','POST')).status).toBe(403);
  });

  it('matriz fail-closed: nenhuma rota legada volta a funcionar nas empresas A/B', async () => {
    const forbidden: Array<[string, string]> = [
      ['POST', '/api/employee/punch'],
      ['GET', '/api/employee/history'],
      ['GET', '/api/admin/employees'],
      ['POST', '/api/admin/employees'],
      ['GET', '/api/admin/reports'],
      ['GET', '/api/auth/session'],
      ['POST', '/api/auth/admin/login'],
      ['GET', '/api/company/employees/employee-b'],
      ['PATCH', '/api/company/employees/employee-b'],
      ['DELETE', '/api/company/employees/employee-b'],
      ['POST', '/api/company/employees']
    ];
    for (const scenario of ['company-a', 'company-b'] as const) {
      const t = makeEnvironment(scenario);
      for (const [method, path] of forbidden) {
        const response = await t.request(path, method);
        expect(response.status, `${scenario} ${method} ${path}`).toBe(503);
        const data = await jsonBody(response);
        expect(data.error.code).toBe('tenant_isolation_pending');
      }
      expect(t.statements.some(sql => /FROM\\s+employees\\b/i.test(sql))).toBe(false);
    }
  });

  it('cookie de empresa nao concede sessao Superadmin nem CPF', async () => {
    const company = makeEnvironment('company-a');
    const platform = await company.request('/api/platform/companies');
    expect(platform.status).toBe(401);
    const cpfHistory = await company.request('/api/employee/cpf-work/history');
    expect(cpfHistory.status).toBe(401);
    const cpfToday = await company.request('/api/employee/cpf-work/today');
    expect(cpfToday.status).toBe(401);
    expect(company.statements.some(sql => /FROM\\s+employees\\b/i.test(sql))).toBe(false);
  });

  it('rotas de jornada exigem flag mesmo para administrador com sessao valida', async () => {
    const t = makeEnvironment('company-a');
    const response = await t.request('/api/company/schedules', 'GET');
    expect(response.status).toBe(503);
    const data = await jsonBody(response);
    expect(data.error.code).toBe('company_schedules_unavailable');
    expect(t.statements.some(sql => /FROM\\s+schedules\\b/i.test(sql))).toBe(false);
  });

  it('nao libera cadastro de funcionarios', async () => {
    const t = makeEnvironment('company-a');

    const response = await t.request(
      '/api/company/employees',
      'POST'
    );

    expect(response.status).toBe(503);
  });

  it('nao libera exclusao de funcionarios', async () => {
    const t = makeEnvironment('company-a');

    const response = await t.request(
      '/api/company/employees/employee-a',
      'DELETE'
    );

    expect(response.status).toBe(503);
  });

  it('nao libera edicao de funcionarios', async () => {
    const t = makeEnvironment('company-a');

    const response = await t.request(
      '/api/company/employees/employee-a',
      'PATCH'
    );

    expect(response.status).toBe(503);
  });
});
