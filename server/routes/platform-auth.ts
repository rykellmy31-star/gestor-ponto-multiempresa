
import { Hono } from 'hono';
import { z } from 'zod';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

import type { App, Ctx } from '../types';
import { platformInvite,activatePlatformInvite,changePlatformPassword } from './platform-owner-access';
import { body } from '../core/validation';
import { ensure } from '../core/errors';

import {
  hashPassword,
  keyedHash,
  randomToken,
  safeEqual,
  sha256,
  verifyPassword
} from '../core/crypto';

import {
  ipHash,
  limit
} from '../core/security';

export const platformAuthRoutes = new Hono<App>();

type PlatformAdmin = {
  id: string;
  login: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  active: number;
  auth_version: number;
  must_change_password: number;
  temporary_password_expires_at:number|null;
};

type PlatformSession = {
  id: string;
  login: string;
  email: string | null;
  display_name: string;
  csrf_token: string;
  expires_at: number;
  last_seen_at: number;
  must_change_password:number;
  temporary_password_expires_at:number|null;
};

function platformCookieName(c: Ctx) {
  return c.env.ENVIRONMENT === 'production'
    ? '__Host-cr_jornada_platform'
    : 'cr_jornada_platform_dev';
}

function platformCookieOptions(c: Ctx) {
  return {
    httpOnly: true,
    secure:
      c.env.ENVIRONMENT === 'production' ||
      new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict' as const,
    path: '/'
  };
}

export async function recordPlatformAudit(
  c: Ctx,
  action: string,
  actorId: string | null,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {}
) {
  await c.get('db')
    .prepare(`
      INSERT INTO platform_audit_log (
        id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      Date.now()
    )
    .run();
}

// FUNÇÃO EXPORTADA PARA OUTRAS ROTAS DO SUPERADMIN

export async function getPlatformSession(c: Ctx,allowRestricted=false) {
  const token = getCookie(c, platformCookieName(c));

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
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
        a.must_change_password,a.temporary_password_expires_at,
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
      now - 30 * 60000
    )
    .first<PlatformSession>();

  if (!session || (!allowRestricted&&session.must_change_password===1) ||
      (session.must_change_password===1&&session.temporary_password_expires_at!==null&&session.temporary_password_expires_at<=now)) {
    return null;
  }

  return {
    ...session,
    tokenHash
  };
}

// LOGIN DO SUPERADMIN

platformAuthRoutes.post('/login', async c => {
  const input = await body(
    c,
    z.object({
      login: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(128)
    }).strict()
  );

  const identifier = input.login.toLowerCase();

  await limit(
    c,
    `platform-login-ip:${ipHash(c)}`,
    30,
    15 * 60000
  );

  await limit(
    c,
    `platform-login-account:${identifier}`,
    10,
    15 * 60000
  );

  const admin = await c.get('db')
    .prepare(`
      SELECT
        id,
        login,
        email,
        display_name,
        password_hash,
        active,
        auth_version,must_change_password,temporary_password_expires_at
      FROM platform_admins
      WHERE login = ?
    `)
    .bind(identifier)
    .first<PlatformAdmin>();

  const valid = admin
    ? await verifyPassword(
        input.password,
        admin.password_hash,
        c.env.AUTH_PEPPER
      )
    : (
        await hashPassword(
          input.password,
          c.env.AUTH_PEPPER
        ),
        false
      );

  if (!valid || !admin || admin.active !== 1 || (admin.must_change_password===1&&admin.temporary_password_expires_at!==null&&admin.temporary_password_expires_at<=Date.now())) {
    await recordPlatformAudit(
      c,
      'platform.login_failed',
      null,
      'auth',
      null
    );

    return c.json({
      error: {
        code: 'invalid_credentials',
        message: 'Usuário ou senha inválidos.'
      }
    }, 401);
  }

  const token = randomToken();
  const csrfToken = randomToken();
  const now = Date.now();

  const hours = Math.min(
    12,
    Math.max(
      1,
      Number(c.env.SESSION_HOURS) || 8
    )
  );

  const expiresAt = now + hours * 3600000;

  const inserted=await c.get('db')
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
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS(
        SELECT 1 FROM platform_admins WHERE id=? AND password_hash=? AND auth_version=? AND active=1
          AND (must_change_password=0 OR temporary_password_expires_at IS NULL OR temporary_password_expires_at>?))
    `)
    .bind(
      sha256(token),
      admin.id,
      csrfToken,
      now,
      expiresAt,
      now,
      now,
      admin.auth_version,admin.id,admin.password_hash,admin.auth_version,now
    )
    .run();
  ensure(inserted.meta.changes===1,409,'platform_login_changed','A conta mudou. Entre novamente.');

  setCookie(
    c,
    platformCookieName(c),
    token,
    {
      ...platformCookieOptions(c),
      maxAge: Math.floor(hours * 3600)
    }
  );

  await c.get('db')
    .prepare('DELETE FROM rate_limits WHERE key = ?')
    .bind(
      keyedHash(
        `platform-login-account:${identifier}`,
        c.env.AUTH_PEPPER
      )
    )
    .run();

  await recordPlatformAudit(
    c,
    'platform.login',
    admin.id,
    'platform_admin',
    admin.id
  );

  return c.json({
    success: true,
    message: 'Acesso ao CR JORNADA autorizado.'
  });
});

// CONSULTAR SESSÃO

platformAuthRoutes.get('/session', async c => {
  const session = await getPlatformSession(c,true);

  ensure(
    session,
    401,
    'unauthenticated',
    'Sua sessão expirou. Entre novamente.'
  );

  const now = Date.now();

  if (now - session.last_seen_at > 60000) {
    await c.get('db')
      .prepare(`
        UPDATE platform_sessions
        SET last_seen_at = ?
        WHERE token_hash = ?
      `)
      .bind(now, session.tokenHash)
      .run();
  }

  return c.json({
    user: {
      id: session.id,
      login: session.login,
      email: session.email,
      name: session.display_name,
      role: 'superadmin',
      must_change_password:session.must_change_password===1
    },
    csrf_token: session.csrf_token,
    expires_at: session.expires_at,
    server_now: now
  });
});

// LOGOUT DO SUPERADMIN

platformAuthRoutes.post('/logout', async c => {
  const session = await getPlatformSession(c,true);

  ensure(
    session,
    401,
    'unauthenticated',
    'Sua sessão expirou. Entre novamente.'
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
      DELETE FROM platform_sessions
      WHERE token_hash = ?
    `)
    .bind(session.tokenHash)
    .run();

  deleteCookie(
    c,
    platformCookieName(c),
    platformCookieOptions(c)
  );

  await recordPlatformAudit(
    c,
    'platform.logout',
    session.id,
    'platform_admin',
    session.id
  );

  return c.json({
    success: true,
    message: 'Sessão encerrada com sucesso.'
  });
});

platformAuthRoutes.post('/invitations',platformInvite);
platformAuthRoutes.post('/activate',activatePlatformInvite);
platformAuthRoutes.post('/change-password',changePlatformPassword);
