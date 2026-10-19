
import { Hono } from 'hono';
import { z } from 'zod';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { App, Ctx } from '../types';
import { ensure, ApiError } from '../core/errors';
import { hashPassword, randomToken, safeEqual, sha256, verifyPassword } from '../core/crypto';
import { ipHash, limit } from '../core/security';
import { employeeCpfLookupKey } from '../core/employee-cpf';
import {
  resolveEmployeeCpfCredentials,
  type EmployeeCpfCandidate
} from '../core/employee-cpf-credentials';

export const employeeCpfAuthRoutes = new Hono<App>();

// Sem reutilizar as sessoes ou cookies do sistema legado.
const sessionCookie = (c: Ctx) =>
  c.env.ENVIRONMENT === 'production'
    ? '__Host-cr_jornada_employee'
    : 'cr_jornada_employee_dev';

const challengeCookie = (c: Ctx) =>
  c.env.ENVIRONMENT === 'production'
    ? '__Host-cr_jornada_employee_choice'
    : 'cr_jornada_employee_choice_dev';

const cookieOptions = (c: Ctx) => ({
  httpOnly: true,
  secure: c.env.ENVIRONMENT === 'production' ||
    new URL(c.req.url).protocol === 'https:',
  sameSite: 'Strict' as const,
  path: '/'
});

type CandidateRow = {
  user_id: string;
  password_hash: string;
  auth_version: number;
  account_active: number;
  employee_id: string;
  company_id: string;
  company_name: string;
  company_status: string;
  employee_status: string;
  deleted_at: number | null;
};

type Choice = {
  user_id: string;
  employee_id: string;
  company_id: string;
  auth_version: number;
};

type ActiveSession = {
  user_id: string;
  employee_id: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  display_name: string;
  csrf_token: string;
  token_hash: string;
  expires_at: number;
  last_seen_at: number;
  must_change_password: number;
};

const credentialError = () =>
  new ApiError(401, 'invalid_credentials', 'CPF ou senha inválidos.');

function requireLookupSecret(c: Ctx): string {
  const secret = c.env.CPF_LOOKUP_SECRET;
  ensure(
    typeof secret === 'string' && secret.length >= 32,
    503,
    'cpf_login_unavailable',
    'Login por CPF ainda não configurado.'
  );
  return secret;
}

const sessionInsertSql = `
  INSERT INTO employee_company_sessions (
    token_hash, user_id, employee_id, company_id, csrf_token,
    created_at, expires_at, last_seen_at, auth_version
  )
  SELECT ?, u.id, e.id, co.id, ?, ?, ?, ?, u.auth_version
  FROM users u
  JOIN employees e ON e.id = u.employee_id
  JOIN companies co ON co.id = e.company_id
  JOIN employee_cpf_links l ON l.employee_id = e.id AND l.company_id = co.id
  WHERE u.id = ? AND e.id = ? AND co.id = ?
    AND u.auth_version = ?
    AND u.role = 'employee' AND u.active = 1
    AND e.status = 'active' AND e.deleted_at IS NULL
    AND co.status = 'active'
`;

function sessionInsert(
  c: Ctx,
  choice: Choice,
  token: string,
  csrf: string,
  now: number,
  proofSql = '',
  proofParams: (string | number)[] = []
) {
  const hours = Math.min(12, Math.max(1, Number(c.env.SESSION_HOURS) || 8));
  return c.get('db').prepare(
    sessionInsertSql + proofSql
  ).bind(
    sha256(token), csrf, now, now + hours * 3600000, now,
    choice.user_id, choice.employee_id, choice.company_id,
    choice.auth_version, ...proofParams
  );
}

function setSessionCookie(c: Ctx, token: string) {
  const hours = Math.min(12, Math.max(1, Number(c.env.SESSION_HOURS) || 8));
  setCookie(c, sessionCookie(c), token, {
    ...cookieOptions(c),
    maxAge: hours * 3600
  });
}

async function getSession(c: Ctx): Promise<ActiveSession | null> {
  const token = getCookie(c, sessionCookie(c));
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const now = Date.now();
  const row = await c.get('db').prepare(`
    SELECT
      s.user_id, s.employee_id, s.company_id, s.csrf_token,
      s.token_hash, s.expires_at, s.last_seen_at,
      u.display_name, u.must_change_password,
      co.name AS company_name, co.slug AS company_slug
    FROM employee_company_sessions s
    JOIN users u
      ON u.id = s.user_id AND u.employee_id = s.employee_id
    JOIN employees e
      ON e.id = s.employee_id AND e.company_id = s.company_id
    JOIN companies co ON co.id = s.company_id
    JOIN employee_cpf_links l
      ON l.employee_id = s.employee_id AND l.company_id = s.company_id
    WHERE s.token_hash = ?
      AND s.auth_version = u.auth_version
      AND u.role = 'employee' AND u.active = 1
      AND e.status = 'active' AND e.deleted_at IS NULL
      AND co.status = 'active'
      AND s.expires_at > ?
      AND s.last_seen_at > ?
  `).bind(sha256(token), now, now - 60 * 60000)
    .first<ActiveSession>();

  if (row && now - row.last_seen_at > 60000) {
    await c.get('db').prepare(`
      UPDATE employee_company_sessions SET last_seen_at = ?
      WHERE token_hash = ? AND expires_at > ?
    `).bind(now, row.token_hash, now).run();
  }
  return row;
}

// CPF + senha: escolhe automaticamente um vinculo quando apenas um
// possui a senha validada. Quando varios validam, emite desafio curto.
employeeCpfAuthRoutes.post('/login', async c => {
  const parsed = z.object({
    cpf: z.string().trim().min(11).max(14),
    password: z.string().min(1).max(128)
  }).strict().safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_login', 'Confira o CPF e a senha.');

  const secret = requireLookupSecret(c);
  await limit(c, 'employee-cpf-ip:' + ipHash(c), 20, 15 * 60000);

  let lookupKey: string;
  try {
    lookupKey = employeeCpfLookupKey(parsed.data.cpf, secret);
  } catch {
    throw credentialError();
  }

  await limit(c, 'employee-cpf-account:' + lookupKey, 8, 15 * 60000);
  const result = await c.get('db').prepare(`
    SELECT u.id AS user_id, u.password_hash, u.auth_version,
      u.active AS account_active,
      e.id AS employee_id, e.company_id, e.status AS employee_status,
      e.deleted_at, co.name AS company_name, co.status AS company_status
    FROM employee_cpf_links l
    JOIN employees e ON e.id = l.employee_id AND e.company_id = l.company_id
    JOIN companies co ON co.id = l.company_id
    JOIN users u ON u.employee_id = e.id AND u.role = 'employee'
    WHERE l.cpf_lookup_key = ?
    ORDER BY co.id
    LIMIT 9
  `).bind(lookupKey).all<CandidateRow>();

  const rows = result.results || [];
  // Limita o custo de scrypt e impede resultados truncados silenciosamente.
  if (rows.length > 8) throw credentialError();

  const candidates: EmployeeCpfCandidate[] = rows.map(row => ({
    user_id: row.user_id,
    password_hash: row.password_hash,
    link: {
      employee_id: row.employee_id,
      company_id: row.company_id,
      company_name: row.company_name,
      company_status: row.company_status,
      employee_status: row.employee_status,
      deleted_at: row.deleted_at,
      account_active: row.account_active === 1
    }
  }));

  // Para CPF desconhecido, executa um hash para minimizar diferenca
  // grosseira entre contas inexistentes e senha errada.
  if (!candidates.length) {
    await hashPassword(parsed.data.password, c.env.AUTH_PEPPER);
    throw credentialError();
  }

  const decision = await resolveEmployeeCpfCredentials(
    parsed.data.password,
    candidates,
    (password, hash) => verifyPassword(password, hash, c.env.AUTH_PEPPER)
  );
  if (decision.mode === 'denied') throw credentialError();

  const links = decision.mode === 'automatic'
    ? [decision.link] : decision.links;

  const choices: Choice[] = links.map(link => {
    const matched = rows.find(row => row.employee_id === link.employee_id);
    if (!matched) throw credentialError();
    return {
      user_id: matched.user_id,
      employee_id: matched.employee_id,
      company_id: matched.company_id,
      auth_version: matched.auth_version
    };
  });

  if (decision.mode === 'automatic') {
    const token = randomToken(), csrf = randomToken(), now = Date.now();
    const inserted = await sessionInsert(
      c, choices[0], token, csrf, now
    ).run();
    ensure(inserted.meta.changes === 1, 401,
      'invalid_credentials', 'Acesso não autorizado.');
    setSessionCookie(c, token);
    return c.json({ success: true, selection_required: false });
  }

  const token = randomToken(), now = Date.now();
  await c.get('db').prepare(`
    INSERT INTO employee_login_challenges (
      token_hash, choices_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?)
  `).bind(
    sha256(token), JSON.stringify(choices), now, now + 5 * 60000
  ).run();
  setCookie(c, challengeCookie(c), token, {
    ...cookieOptions(c), maxAge: 300
  });
  return c.json({
    success: true,
    selection_required: true,
    companies: links.map(link => ({
      id: link.company_id, name: link.company_name
    }))
  });
});

// So a empresa autorizada no desafio pode receber uma sessao.
// UPDATE e INSERT ocorrem na mesma transacao D1.
employeeCpfAuthRoutes.post('/select', async c => {
  await limit(c, 'employee-select-ip:' + ipHash(c), 20, 15 * 60000);
  const body = z.object({
    company_id: z.string().trim().min(1).max(128)
  }).strict().safeParse(await c.req.json().catch(() => null));
  ensure(body.success, 400, 'invalid_selection', 'Empresa inválida.');

  const challenge = getCookie(c, challengeCookie(c));
  ensure(challenge && /^[a-f0-9]{64}$/.test(challenge),
    401, 'expired_selection', 'Escolha expirada. Entre novamente.');

  const challengeHash = sha256(challenge);
  const now = Date.now();
  const record = await c.get('db').prepare(`
    SELECT choices_json FROM employee_login_challenges
    WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL
  `).bind(challengeHash, now).first<{ choices_json: string }>();
  ensure(record, 401, 'expired_selection', 'Escolha expirada. Entre novamente.');

  let choices: Choice[] = [];
  try {
    const parsedChoices: unknown = JSON.parse(record.choices_json);
    if (!Array.isArray(parsedChoices)) throw new Error('invalid');
    choices = parsedChoices.filter((item): item is Choice =>
      item !== null && typeof item === 'object' &&
      typeof item.user_id === 'string' &&
      typeof item.employee_id === 'string' &&
      typeof item.company_id === 'string' &&
      Number.isSafeInteger(item.auth_version)
    );
    if (choices.length !== parsedChoices.length || choices.length > 8) {
      throw new Error('invalid');
    }
  } catch {
    throw new ApiError(401, 'expired_selection', 'Escolha expirada.');
  }
  const selected = choices.find(choice =>
    choice.company_id === body.data.company_id
  );
  ensure(selected, 403, 'company_access_denied',
    'Empresa não autorizada.');

  const token = randomToken(), csrf = randomToken();
  const nonce = randomToken();
  const result = await c.get('db').batch([
    c.get('db').prepare(`
      UPDATE employee_login_challenges
      SET used_at = ?, consumed_nonce = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    `).bind(now, nonce, challengeHash, now),
    sessionInsert(c, selected, token, csrf, now, `
      AND EXISTS (
        SELECT 1 FROM employee_login_challenges ch
        WHERE ch.token_hash = ?
          AND ch.consumed_nonce = ?
          AND ch.used_at = ?
      )
    `, [challengeHash, nonce, now])
  ]);

  ensure(result[0].meta.changes === 1 && result[1].meta.changes === 1,
    401, 'expired_selection', 'Escolha expirada. Entre novamente.');

  deleteCookie(c, challengeCookie(c), cookieOptions(c));
  setSessionCookie(c, token);
  return c.json({ success: true, selection_required: false });
});

employeeCpfAuthRoutes.get('/session', async c => {
  const session = await getSession(c);
  ensure(session, 401, 'unauthenticated', 'Entre para continuar.');
  return c.json({
    user: {
      id: session.user_id,
      employee_id: session.employee_id,
      name: session.display_name,
      must_change_password: Boolean(session.must_change_password),
      role: 'employee'
    },
    company: {
      id: session.company_id, name: session.company_name,
      slug: session.company_slug
    },
    csrf_token: session.csrf_token,
    expires_at: session.expires_at,
    server_now: Date.now()
  });
});

employeeCpfAuthRoutes.post('/logout', async c => {
  const session = await getSession(c);
  ensure(session, 401, 'unauthenticated', 'Sua sessão expirou.');
  ensure(safeEqual(
    c.req.header('X-CSRF-Token') || '', session.csrf_token
  ), 403, 'csrf', 'Token de segurança inválido.');
  await c.get('db').prepare(`
    DELETE FROM employee_company_sessions WHERE token_hash = ?
  `).bind(session.token_hash).run();
  deleteCookie(c, sessionCookie(c), cookieOptions(c));
  return c.json({ success: true });
});
