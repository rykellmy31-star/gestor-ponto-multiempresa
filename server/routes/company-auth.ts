
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

import type { App, Ctx } from '../types';
import { ensure } from '../core/errors';
import {
  hashPassword,
  randomToken,
  safeEqual,
  sha256,
  verifyPassword
} from '../core/crypto';
import { ipHash, limit } from '../core/security';

export const companyAuthRoutes = new Hono<App>();

const cookieName = (c: Ctx) =>
  c.env.ENVIRONMENT === 'production'
    ? '__Host-cr_jornada_company'
    : 'cr_jornada_company_dev';

const cookieOptions = (c: Ctx) => ({
  httpOnly: true,
  secure:
    c.env.ENVIRONMENT === 'production' ||
    new URL(c.req.url).protocol === 'https:',
  sameSite: 'Strict' as const,
  path: '/'
});

export type CompanyAdminSession = {
  id: string;
  company_id: string;
  login: string;
  display_name: string;
  csrf_token: string;
  expires_at: number;
  last_seen_at: number;
  token_hash: string;
  slug: string;
};

async function getSession(
  c: Ctx
): Promise<CompanyAdminSession | null> {
  const token = getCookie(c, cookieName(c));

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return null;
  }

  const now = Date.now();

  const session = await c.get('db').prepare(`
    SELECT
      a.id,
      a.company_id,
      a.login,
      a.display_name,
      s.csrf_token,
      s.expires_at,
      s.last_seen_at,
      s.token_hash,
      co.slug
    FROM company_admin_sessions s
    JOIN company_admins a
      ON a.id = s.admin_id
      AND a.company_id = s.company_id
    JOIN companies co
      ON co.id = s.company_id
    WHERE s.token_hash = ?
      AND s.auth_version = a.auth_version
      AND a.active = 1
      AND co.status = 'active'
      AND s.expires_at > ?
      AND s.last_seen_at > ?
  `)
    .bind(
      sha256(token),
      now,
      now - 30 * 60000
    )
    .first<CompanyAdminSession>();

  if (!session) {
    return null;
  }

  if (now - session.last_seen_at > 60000) {
    await c.get('db')
      .prepare(`
        UPDATE company_admin_sessions
        SET last_seen_at = ?
        WHERE token_hash = ?
      `)
      .bind(now, session.token_hash)
      .run();
  }

  return session;
}

// Protecao para futuras rotas administrativas empresariais.
// A empresa sempre e identificada pela sessao autenticada.
export const requireCompanyAdmin = createMiddleware<App>(
  async (c, next) => {
    const session = await getSession(c);

    ensure(
      session,
      401,
      'unauthenticated',
      'Entre na sua empresa para continuar.'
    );

    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
    ) {
      ensure(
        safeEqual(
          c.req.header('X-CSRF-Token') || '',
          session.csrf_token
        ),
        403,
        'csrf',
        'Token de segurança inválido.'
      );
    }

    c.set('company', {
      id: session.company_id,
      slug: session.slug
    } as App['Variables']['company']);
    c.set('companyAdminId', session.id);

    await next();
  }
);

// LOGIN DO ADMINISTRADOR DA EMPRESA
companyAuthRoutes.post('/login', async c => {
  const parsed = z.object({
    company: z.string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),

    login: z.string()
      .trim()
      .min(1)
      .max(200),

    password: z.string()
      .min(1)
      .max(128)
  })
    .strict()
    .safeParse(
      await c.req.json().catch(() => null)
    );

  ensure(
    parsed.success,
    400,
    'invalid_login',
    'Confira os dados de acesso.'
  );

  const {
    company,
    login,
    password
  } = parsed.data;

  await limit(
    c,
    `company-login-ip:${ipHash(c)}`,
    30,
    15 * 60000
  );

  await limit(
    c,
    `company-login-account:${company}:${login.toLowerCase()}`,
    10,
    15 * 60000
  );

  const row = await c.get('db').prepare(`
    SELECT
      a.id,
      a.company_id,
      a.password_hash,
      a.auth_version
    FROM company_admins a
    JOIN companies co
      ON co.id = a.company_id
    WHERE co.slug = ? COLLATE NOCASE
      AND a.login = ? COLLATE NOCASE
      AND a.active = 1
      AND co.status = 'active'
  `)
    .bind(company, login)
    .first<{
      id: string;
      company_id: string;
      password_hash: string;
      auth_version: number;
    }>();

  const valid = row
    ? await verifyPassword(
        password,
        row.password_hash,
        c.env.AUTH_PEPPER
      )
    : (
        await hashPassword(
          password,
          c.env.AUTH_PEPPER
        ),
        false
      );

  ensure(
    valid && row,
    401,
    'invalid_credentials',
    'Empresa, usuário ou senha inválidos.'
  );

  const token = randomToken();
  const now = Date.now();

  const hours = Math.min(
    12,
    Math.max(
      1,
      Number(c.env.SESSION_HOURS) || 8
    )
  );

  await c.get('db').prepare(`
    INSERT INTO company_admin_sessions (
      token_hash,
      company_id,
      admin_id,
      csrf_token,
      created_at,
      expires_at,
      last_seen_at,
      auth_version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      sha256(token),
      row.company_id,
      row.id,
      randomToken(),
      now,
      now + hours * 3600000,
      now,
      row.auth_version
    )
    .run();

  setCookie(
    c,
    cookieName(c),
    token,
    {
      ...cookieOptions(c),
      maxAge: hours * 3600
    }
  );

  return c.json({
    success: true
  });
});

// CONSULTAR SESSAO EMPRESARIAL
companyAuthRoutes.get('/session', async c => {
  const session = await getSession(c);

  ensure(
    session,
    401,
    'unauthenticated',
    'Entre na sua empresa para continuar.'
  );

  return c.json({
    user: {
      id: session.id,
      login: session.login,
      name: session.display_name,
      role: 'admin'
    },

    company: {
      id: session.company_id,
      slug: session.slug
    },

    csrf_token: session.csrf_token,
    expires_at: session.expires_at,
    server_now: Date.now()
  });
});

// ENCERRAR SESSAO EMPRESARIAL
companyAuthRoutes.post('/logout', async c => {
  const session = await getSession(c);

  ensure(
    session,
    401,
    'unauthenticated',
    'Sua sessão expirou.'
  );

  ensure(
    safeEqual(
      c.req.header('X-CSRF-Token') || '',
      session.csrf_token
    ),
    403,
    'csrf',
    'Token de segurança inválido.'
  );

  await c.get('db')
    .prepare(`
      DELETE FROM company_admin_sessions
      WHERE token_hash = ?
    `)
    .bind(session.token_hash)
    .run();

  deleteCookie(
    c,
    cookieName(c),
    cookieOptions(c)
  );

  return c.json({
    success: true
  });
});
