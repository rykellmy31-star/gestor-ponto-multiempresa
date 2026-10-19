
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companyAuthRoutes } from '../server/routes/company-auth';

vi.mock('../server/core/security', () => ({
  ipHash: () => 'test-ip',
  limit: async () => undefined
}));

vi.mock('../server/core/crypto', () => ({
  hashPassword: async () => 'dummy-hash',
  verifyPassword: async (password: string, stored: string) =>
    password === 'senha-correta' && stored === 'hash-valido',
  randomToken: () => 'a'.repeat(64),
  sha256: () => 'token-hash',
  safeEqual: (a: string, b: string) => a === b
}));

type Scenario = 'active' | 'suspended';

function makeApp(scenario: Scenario, expiresAt: number | null = null) {
  const statements: string[] = [];

  const db = {
    prepare(sql: string) {
      const statement = {
        bind(..._args: unknown[]) {
          return statement;
        },

        async first() {
          statements.push(sql);

          // Reconhece a consulta mesmo com quebras de linha
          // e diferentes quantidades de espacos.
          if (
            /FROM\s+company_admins\s+a\s+JOIN\s+companies\s+co/i.test(sql)
          ) {
            return scenario === 'active'
              ? {
                  id: 'admin-1',
                  company_id: 'company-1',
                  password_hash: 'hash-valido',
                  auth_version: 0,
                  must_change_password: expiresAt === null ? 0 : 1,
                  temporary_password_expires_at: expiresAt
                }
              : null;
          }

          if (sql.includes('FROM company_admin_sessions s')) {
            return scenario === 'active'
              ? {
                  id: 'admin-1',
                  company_id: 'company-1',
                  login: 'gestor',
                  display_name: 'Gestor',
                  csrf_token: 'csrf',
                  expires_at: Date.now() + 60000,
                  last_seen_at: Date.now(),
                  token_hash: 'token-hash',
                  must_change_password: expiresAt === null ? 0 : 1,
                  temporary_password_expires_at: expiresAt,
                  slug: 'empresa-a'
                }
              : null;
          }

          return null;
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

  app.route('/api/company/auth', companyAuthRoutes);

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
          code: 'internal_error'
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

  const postLogin = (password: string) =>
    app.request(
      '/api/company/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          company: 'empresa-a',
          login: 'gestor',
          password
        })
      },
      env as any
    );

  return {
    app,
    statements,
    env,
    postLogin
  };
}

describe('CR JORNADA - autenticacao empresarial', () => {
  it('rejeita senha provisoria vencida e impede criar sessao',async()=>{
    const t=makeApp('active', Date.now()-1000);
    const res=await t.postLogin('senha-correta');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
    expect(t.statements.some(x=>x.includes('INSERT INTO company_admin_sessions')))
      .toBe(false);
  });

  it('bloqueia sessao existente quando a senha provisoria expira', async () => {
    const t = makeApp('active', Date.now() - 1000);
    const session = await t.app.request('/api/company/auth/session', {
      headers: { cookie: 'cr_jornada_company_dev=' + 'a'.repeat(64) }
    }, t.env as any);
    expect(session.status).toBe(401);
    expect((await session.json()).error.code).toBe('unauthenticated');
  });

  it('recusa senha provisoria expirada exatamente no instante limite', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const t = makeApp('active', now);
      const res = await t.postLogin('senha-correta');
      expect(res.status).toBe(401);
      expect(t.statements.some(sql => sql.includes('INSERT INTO company_admin_sessions')))
        .toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it('permite autenticar senha provisoria nao vencida apenas para troca',async()=>{
    const t=makeApp('active',Date.now()+3600000);
    const login=await t.postLogin('senha-correta');
    expect(login.status).toBe(200);
    const session=await t.app.request('/api/company/auth/session',{
      headers:{cookie:'cr_jornada_company_dev='+'a'.repeat(64)}
    },t.env as any);
    expect(session.status).toBe(200);
    expect((await session.json()).must_change_password).toBe(true);
  });

  it(
    'permite login com credenciais corretas em empresa ativa',
    async () => {
      const t = makeApp('active');

      const res = await t.postLogin('senha-correta');

      expect(res.status).toBe(200);

      expect((await res.json()).success).toBe(true);

      expect(res.headers.get('set-cookie'))
        .toContain('cr_jornada_company_dev=');

      expect(
        t.statements.some(s =>
          s.includes('INSERT INTO company_admin_sessions')
        )
      ).toBe(true);
    }
  );

  it(
    'rejeita senha incorreta sem criar sessao',
    async () => {
      const t = makeApp('active');

      const res = await t.postLogin('senha-errada');

      expect(res.status).toBe(401);

      expect((await res.json()).error.code)
        .toBe('invalid_credentials');

      expect(
        t.statements.some(s =>
          s.includes('INSERT INTO company_admin_sessions')
        )
      ).toBe(false);
    }
  );

  it(
    'rejeita login de empresa suspensa',
    async () => {
      const t = makeApp('suspended');

      const res = await t.postLogin('senha-correta');

      expect(res.status).toBe(401);

      expect((await res.json()).error.code)
        .toBe('invalid_credentials');

      expect(
        t.statements.some(s =>
          s.includes('INSERT INTO company_admin_sessions')
        )
      ).toBe(false);
    }
  );
});
