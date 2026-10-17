
import { Hono } from 'hono';
import type { App } from '../types';
import {
  getCookie,
  setCookie,
  deleteCookie
} from 'hono/cookie';

import {
  randomToken,
  sha256,
  safeEqual,
  verifyPassword
} from '../core/crypto';

export const platformAuthRoutes = new Hono<App>();

type PlatformAdmin = {
  id: string;
  login: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  active: number;
  auth_version: number;
};

type PlatformSession = {
  id: string;
  login: string;
  email: string | null;
  display_name: string;
  active: number;
  csrf_token: string;
  expires_at: number;
  last_seen_at: number;
};

function cookieName(
  environment: string
): string {
  return environment === 'production'
    ? '__Host-cr_jornada_platform'
    : 'cr_jornada_platform_dev';
}

function cookieOptions(
  environment: string
) {
  return {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'Strict' as const,
    path: '/'
  };
}

function failure(
  c: any,
  status: 400 | 401 | 403 | 429,
  message: string
) {
  return c.json(
    {
      success: false,
      error: message
    },
    status
  );
}

async function getSession(
  c: any
): Promise<PlatformSession | null> {
  const token = getCookie(
    c,
    cookieName(c.env.ENVIRONMENT)
  );

  if (
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return null;
  }

  const tokenHash = sha256(token);
  const now = Date.now();

  const session = await c.get('db')
    .prepare(`
      SELECT
        a.id,
        a.login,
        a.email,
        a.display_name,
        a.active,
        s.csrf_token,
        s.expires_at,
        s.last_seen_at
      FROM platform_sessions s
      JOIN platform_admins a
        ON a.id = s.admin_id
      WHERE s.token_hash = ?
        AND s.auth_version = a.auth_version
        AND a.active = 1
        AND s.expires_at > ?
        AND s.last_seen_at > ?
    `)
    .bind(
      tokenHash,
      now,
      now - 30 * 60 * 1000
    )
    .first<PlatformSession>();

  return session ?? null;
}

/*
 * LOGIN DO SUPERADMIN
 */
platformAuthRoutes.post(
  '/login',
  async c => {
    let input: unknown;

    try {
      input = await c.req.json();
    } catch {
      return failure(
        c,
        400,
        'JSON inválido.'
      );
    }

    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input)
    ) {
      return failure(
        c,
        400,
        'Dados inválidos.'
      );
    }

    const data = input as Record<
      string,
      unknown
    >;

    if (
      typeof data.login !== 'string' ||
      typeof data.password !== 'string' ||
      data.login.trim().length < 1 ||
      data.login.length > 200 ||
      data.password.length < 1 ||
      data.password.length > 128
    ) {
      return failure(
        c,
        400,
        'Login ou senha inválidos.'
      );
    }

    const login = data.login.trim();
    const password = data.password;

    const admin = await c.get('db')
      .prepare(`
        SELECT
          id,
          login,
          email,
          display_name,
          password_hash,
          active,
          auth_version
        FROM platform_admins
        WHERE login = ?
      `)
      .bind(login)
      .first<PlatformAdmin>();

    let valid = false;

    if (admin) {
      valid = await verifyPassword(
        password,
        admin.password_hash,
        c.env.AUTH_PEPPER
      );
    }

    if (
      !admin ||
      admin.active !== 1 ||
      !valid
    ) {
      return failure(
        c,
        401,
        'Usuário ou senha inválidos.'
      );
    }

    const token = randomToken();
    const csrfToken = randomToken();
    const now = Date.now();

    const configuredHours = Number(
      c.env.SESSION_HOURS || 8
    );

    const sessionHours =
      Number.isFinite(configuredHours)
        ? Math.min(
            12,
            Math.max(1, configuredHours)
          )
        : 8;

    const expiresAt =
      now + sessionHours * 3600000;

    await c.get('db')
      .prepare(`
        INSERT INTO platform_sessions (
          token_hash,
          admin_id,
          csrf_token,
          created_at,
          expires_at,
          last_seen_at,
          reauth_at,
          auth_version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        sha256(token),
        admin.id,
        csrfToken,
        now,
        expiresAt,
        now,
        now,
        admin.auth_version
      )
      .run();

    setCookie(
      c,
      cookieName(c.env.ENVIRONMENT),
      token,
      {
        ...cookieOptions(
          c.env.ENVIRONMENT
        ),
        maxAge: Math.floor(
          sessionHours * 3600
        )
      }
    );

    return c.json({
      success: true,
      message:
        'Login realizado com sucesso.',
      user: {
        id: admin.id,
        login: admin.login,
        email: admin.email,
        name: admin.display_name,
        role: 'superadmin'
      }
    });
  }
);

/*
 * CONSULTAR SESSÃO
 */
platformAuthRoutes.get(
  '/session',
  async c => {
    const session =
      await getSession(c);

    if (!session) {
      return failure(
        c,
        401,
        'Sessão inválida ou expirada.'
      );
    }

    const token = getCookie(
      c,
      cookieName(c.env.ENVIRONMENT)
    );

    if (!token) {
      return failure(
        c,
        401,
        'Não autenticado.'
      );
    }

    await c.get('db')
      .prepare(`
        UPDATE platform_sessions
        SET last_seen_at = ?
        WHERE token_hash = ?
      `)
      .bind(
        Date.now(),
        sha256(token)
      )
      .run();

    return c.json({
      success: true,
      user: {
        id: session.id,
        login: session.login,
        email: session.email,
        name: session.display_name,
        role: 'superadmin'
      },
      csrf_token: session.csrf_token,
      expires_at: session.expires_at
    });
  }
);

/*
 * LOGOUT DO SUPERADMIN
 */
platformAuthRoutes.post(
  '/logout',
  async c => {
    const session =
      await getSession(c);

    if (!session) {
      return failure(
        c,
        401,
        'Sessão inválida ou expirada.'
      );
    }

    const csrfToken =
      c.req.header('X-CSRF-Token') || '';

    if (
      !safeEqual(
        csrfToken,
        session.csrf_token
      )
    ) {
      return failure(
        c,
        403,
        'Token de segurança inválido.'
      );
    }

    const token = getCookie(
      c,
      cookieName(c.env.ENVIRONMENT)
    );

    if (!token) {
      return failure(
        c,
        401,
        'Não autenticado.'
      );
    }

    await c.get('db')
      .prepare(`
        DELETE FROM platform_sessions
        WHERE token_hash = ?
      `)
      .bind(sha256(token))
      .run();

    deleteCookie(
      c,
      cookieName(c.env.ENVIRONMENT),
      cookieOptions(
        c.env.ENVIRONMENT
      )
    );

    return c.json({
      success: true,
      message:
        'Sessão encerrada com sucesso.'
    });
  }
);
