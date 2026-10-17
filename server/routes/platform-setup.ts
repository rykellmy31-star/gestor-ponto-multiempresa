
import { Hono } from 'hono';
import { z } from 'zod';

import type { App } from '../types';
import { body, login, password } from '../core/validation';
import { ensure } from '../core/errors';

import {
  hashPassword,
  safeEqual
} from '../core/crypto';

import {
  ipHash,
  limit
} from '../core/security';

export const platformSetupRoutes = new Hono<App>();

platformSetupRoutes.post('/setup', async c => {
  await limit(
    c,
    `platform-setup:${ipHash(c)}`,
    5,
    3600000
  );

  const input = await body(
    c,
    z.object({
      token: z.string().min(32).max(128),
      name: z.string().trim().min(3).max(140),
      login,
      email: z.union([
        z.email(),
        z.literal('')
      ]),
      password
    }).strict()
  );

  ensure(
    c.env.BOOTSTRAP_TOKEN &&
    safeEqual(
      input.token,
      c.env.BOOTSTRAP_TOKEN
    ),
    403,
    'invalid_platform_setup',
    'Código de configuração inválido.'
  );

  const existing = await c.get('db')
    .prepare(`
      SELECT 1 AS ok
      FROM platform_admins
      LIMIT 1
    `)
    .first();

  ensure(
    !existing,
    410,
    'platform_setup_completed',
    'O Superadministrador já foi configurado.'
  );

  const id = crypto.randomUUID();
  const now = Date.now();

  const passwordHash = await hashPassword(
    input.password,
    c.env.AUTH_PEPPER
  );

  await c.get('db')
    .prepare(`
      INSERT INTO platform_admins (
        id,
        login,
        email,
        display_name,
        password_hash,
        active,
        auth_version,
        created_at,
        updated_at
      )
      SELECT ?, ?, ?, ?, ?, 1, 0, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM platform_admins
      )
    `)
    .bind(
      id,
      input.login,
      input.email.toLowerCase() || null,
      input.name,
      passwordHash,
      now,
      now
    )
    .run()
    .then(result => {
      ensure(
        result.meta.changes === 1,
        410,
        'platform_setup_completed',
        'O Superadministrador já foi configurado.'
      );
    });

  return c.json(
    {
      success: true,
      message:
        'Superadministrador CR JORNADA criado com sucesso.'
    },
    201
  );
});
