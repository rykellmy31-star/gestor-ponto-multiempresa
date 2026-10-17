
import { Hono } from 'hono';
import type { App } from '../types';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export const platformAuthRoutes = new Hono<App>();

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: string): Promise<string> {
  return hex(
    await crypto.subtle.digest('SHA-256', encoder.encode(value))
  );
}

async function verifyPassword(
  password: string,
  storedHash: string,
  pepper: string
): Promise<boolean> {
  // O formato da senha precisa ser compatível
  // com o mecanismo utilizado para criar a conta.
  // Até essa integração, o login permanece bloqueado.
  void password;
  void storedHash;
  void pepper;
  return false;
}

function cookieName(c: {
  env: { ENVIRONMENT: string };
}): string {
  return c.env.ENVIRONMENT === 'production'
    ? '__Host-cr_jornada_platform'
    : 'cr_jornada_platform_dev';
}

function cookieOptions(c: {
  env: { ENVIRONMENT: string };
}) {
  return {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: 'Strict' as const,
    path: '/'
  };
}

function error(
  c: any,
  status: 400 | 401 | 403 | 429 | 500,
  message: string
) {
  return c.json({ error: message }, status);
}

platformAuthRoutes.post('/login', async c => {
  let input: unknown;

  try {
    input = await c.req.json();
  } catch {
    return error(c, 400, 'JSON inválido.');
  }

  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return error(c, 400, 'Dados inválidos.');
  }

  const data = input as Record<string, unknown>;

  if (
    typeof data.login !== 'string' ||
    typeof data.password !== 'string' ||
    data.login.length < 1 ||
    data.login.length > 200 ||
    data.password.length < 1 ||
    data.password.length > 128
  ) {
    return error(c, 400, 'Login ou senha inválidos.');
  }

  const admin = await c.get('db')
    .prepare(`
      SELECT id, password_hash, active, auth_version
      FROM platform_admins
      WHERE login = ?
    `)
    .bind(data.login.trim())
    .first<{
      id: string;
      password_hash: string;
      active: number;
      auth_version: number;
    }>();

  const valid = admin
    ? await verifyPassword(
        data.password,
        admin.password_hash,
        c.env.AUTH_PEPPER
      )
    : false;

  if (!admin || admin.active !== 1 || !valid) {
    return error(c, 401, 'Usuário ou senha inválidos.');
  }

  const token = randomHex();
  const csrf = randomHex();
  const now = Date.now();
  const hours = 8;

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      await sha256(token),
      admin.id,
      csrf,
      now,
      now + hours * 3600000,
      now,
      now,
      admin.auth_version
    )
    .run();

  setCookie(c, cookieName(c), token, {
    ...cookieOptions(c),
    maxAge: hours * 3600
  });

  return c.json({
    success: true,
    message: 'Login realizado com sucesso.'
  });
});

platformAuthRoutes.get('/session', async c => {
  const token = getCookie(c, cookieName(c));

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return error(c, 401, 'Não autenticado.');
  }

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
    `)
    .bind(await sha256(token))
    .first<{
      id: string;
      login: string;
      email: string | null;
      display_name: string;
      active: number;
      csrf_token: string;
      expires_at: number;
      last_seen_at: number;
    }>();

  if (
    !session ||
    session.active !== 1 ||
    session.expires_at <= now ||
    session.last_seen_at <= now - 30 * 60000
  ) {
    return error(c, 401, 'Sessão inválida ou expirada.');
  }

  await c.get('db')
    .prepare(`
      UPDATE platform_sessions
      SET last_seen_at = ?
      WHERE token_hash = ?
    `)
    .bind(now, await sha256(token))
    .run();

  return c.json({
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
});

platformAuthRoutes.post('/logout', async c => {
  const token = getCookie(c, cookieName(c));

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return error(c, 401, 'Não autenticado.');
  }

  const tokenHash = await sha256(token);
  const now = Date.now();

  const session = await c.get('db')
    .prepare(`
      SELECT s.csrf_token
      FROM platform_sessions s
      JOIN platform_admins a ON a.id = s.admin_id
      WHERE s.token_hash = ?
        AND s.auth_version = a.auth_version
        AND a.active = 1
        AND s.expires_at > ?
        AND s.last_seen_at > ?
    `)
    .bind(tokenHash, now, now - 30 * 60000)
    .first<{ csrf_token: string }>();

  if (!session) {
    return error(c, 401, 'Sessão inválida.');
  }

  const csrf = c.req.header('X-CSRF-Token');

  if (!csrf || csrf !== session.csrf_token) {
    return error(c, 403, 'Token de segurança inválido.');
  }

  await c.get('db')
    .prepare(`
      DELETE FROM platform_sessions
      WHERE token_hash = ?
    `)
    .bind(tokenHash)
    .run();

  deleteCookie(c, cookieName(c), cookieOptions(c));

  return c.json({
    success: true,
    message: 'Sessão encerrada.'
  });
});
