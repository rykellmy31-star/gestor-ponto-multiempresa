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
function makeApp(scenario: Scenario) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        bind(..._args: unknown[]) { return statement; },
        async first() {
          statements.push(sql);
          if (sql.includes('FROM company_admins a JOIN companies co')) {
            return scenario === 'active'
              ? { id: 'admin-1', company_id: 'company-1', password_hash: 'hash-valido', auth_version: 0 }
              : null;
          }
          if (sql.includes('FROM company_admin_sessions s')) {
            return scenario === 'active'
              ? { id: 'admin-1', company_id: 'company-1', login: 'gestor', display_name: 'Gestor', csrf_token: 'csrf', expires_at: Date.now() + 60000, last_seen_at: Date.now(), token_hash: 'token-hash', slug: 'empresa-a' }
              : null;
          }
          return null;
        },
        async run() { statements.push(sql); return { success: true }; }
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
      return c.json({ error: { code: error.code, message: error.message } }, error.status as any);
    }
    return c.json({ error: { code: 'internal_error' } }, 500);
  });
  const env = { ENVIRONMENT: 'development', AUTH_PEPPER: 'test-pepper'.repeat(5), SESSION_HOURS: '8' };
  const postLogin = (password: string) => app.request('/api/company/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: 'empresa-a', login: 'gestor', password })
  }, env as any);
  return { app, statements, env, postLogin };
}

describe('CR JORNADA - autenticacao empresarial', () => {
  it('permite login com credenciais corretas em empresa ativa', async () => {
    const t = makeApp('active');
    const res = await t.postLogin('senha-correta');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(res.headers.get('set-cookie')).toContain('cr_jornada_company_dev=');
    expect(t.statements.some(s => s.includes('INSERT INTO company_admin_sessions'))).toBe(true);
  });

  it('rejeita senha incorreta sem criar sessao', async () => {
    const t = makeApp('active');
    const res = await t.postLogin('senha-errada');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
    expect(t.statements.some(s => s.includes('INSERT INTO company_admin_sessions'))).toBe(false);
  });

  it('rejeita login de empresa suspensa', async () => {
    const t = makeApp('suspended');
    const res = await t.postLogin('senha-correta');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
    expect(t.statements.some(s => s.includes('INSERT INTO company_admin_sessions'))).toBe(false);
  });
});
