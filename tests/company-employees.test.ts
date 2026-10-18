
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companyEmployeesRoutes } from '../server/routes/company-employees';

vi.mock('../server/core/security', () => ({
  ipHash: () => 'test-ip',
  limit: async () => undefined
}));

vi.mock('../server/core/crypto', () => ({
  hashPassword: async () => 'dummy-hash',
  verifyPassword: async () => true,
  randomToken: () => 'a'.repeat(64),
  sha256: () => 'token-hash',
  safeEqual: (a: string, b: string) => a === b
}));

const employees = [
  {
    id: 'employee-a',
    company_id: 'company-a',
    full_name: 'Funcionario Empresa A',
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
    full_name: 'Funcionario Empresa B',
    registration: 'B001',
    job_title: 'Entregador',
    admission_date: '2026-01-01',
    employment_end: null,
    status: 'active',
    cpf_last4: null,
    deleted_at: null
  }
];

type Scenario = 'company-a' | 'company-b' | 'anonymous';

function makeApp(scenario: Scenario) {
  const statements: string[] = [];

  const db = {
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
              id: `admin-${scenario}`,
              company_id: companyId,
              login: 'gestor',
              display_name: 'Gestor',
              csrf_token: 'csrf-token',
              expires_at: Date.now() + 60000,
              last_seen_at: Date.now(),
              token_hash: 'token-hash',
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

          // Simula o filtro WHERE company_id = ?
          // aplicado pelo banco de dados.
          if (!/WHERE\s+company_id\s*=\s*\?/i.test(sql)) {
            throw new Error(
              'Consulta de funcionarios sem filtro empresarial.'
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

  const app = new Hono<App>();

  app.use('*', async (c, next) => {
    c.set('db', db as any);
    await next();
  });

  app.route('/api/company/employees', companyEmployeesRoutes);

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message
          }
        },
        error.status as any
      );
    }

    return c.json(
      {
        error: {
          code: 'internal_error',
          message: 'Erro interno.'
        }
      },
      500
    );
  });

  const env = {
    ENVIRONMENT: 'development',
    AUTH_PEPPER: 'test-pepper'.repeat(5),
    SESSION_HOURS: '8'
  };

  const getEmployees = (authenticated = true) =>
    app.request(
      '/api/company/employees',
      {
        method: 'GET',
        headers: authenticated
          ? {
              Cookie:
                'cr_jornada_company_dev=' + 'a'.repeat(64)
            }
          : {}
      },
      env as any
    );

  return {
    app,
    statements,
    getEmployees
  };
}

describe('CR JORNADA - isolamento de funcionarios', () => {
  it('empresa A visualiza somente seus funcionarios', async () => {
    const t = makeApp('company-a');

    const res = await t.getEmployees();

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.company_id).toBe('company-a');
    expect(data.employees).toHaveLength(1);
    expect(data.employees[0].id).toBe('employee-a');

    expect(
      data.employees.some(
        (employee: { id: string }) =>
          employee.id === 'employee-b'
      )
    ).toBe(false);
  });

  it('empresa B visualiza somente seus funcionarios', async () => {
    const t = makeApp('company-b');

    const res = await t.getEmployees();

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.company_id).toBe('company-b');
    expect(data.employees).toHaveLength(1);
    expect(data.employees[0].id).toBe('employee-b');
  });

  it('bloqueia acesso sem autenticacao', async () => {
    const t = makeApp('anonymous');

    const res = await t.getEmployees(false);

    expect(res.status).toBe(401);

    expect(
      t.statements.some(sql =>
        /FROM\s+employees\b/i.test(sql)
      )
    ).toBe(false);
  });

  it('consulta utiliza filtro por empresa', async () => {
    const t = makeApp('company-a');

    const res = await t.getEmployees();

    expect(res.status).toBe(200);

    expect(
      t.statements.some(sql =>
        /WHERE\s+company_id\s*=\s*\?/i.test(sql)
      )
    ).toBe(true);
  });
});
