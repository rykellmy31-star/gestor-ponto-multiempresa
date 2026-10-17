
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { App, Env } from './types';
import { ApiError } from './core/errors';
import { auth, getPrincipal, originGuard } from './core/security';

import { authRoutes } from './routes/auth';
import { employeeRoutes } from './routes/employee';
import { adminEmployees } from './routes/admin-employees';
import { adminOperations } from './routes/admin-operations';

// Termometro de Humor da Equipe
import {
  employeeMoodRoutes,
  adminMoodRoutes
} from './routes/mood';

const app = new Hono<App>();

app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('db', c.env.DB.withSession('first-primary'));

  await next();

  const prod = c.env.ENVIRONMENT === 'production';

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');

  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  c.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; ${
      prod
        ? "frame-ancestors 'none'; upgrade-insecure-requests;"
        : ''
    }`
  );

  if (prod) {
    c.header(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
    c.header('X-Frame-Options', 'DENY');
  }

  if (
    c.req.path.startsWith('/api/') ||
    c.res.headers.get('Content-Type')?.includes('text/html') ||
    c.req.path.startsWith('/admin') ||
    c.req.path.startsWith('/app') ||
    c.req.path.includes('senha') ||
    c.req.path === '/setup'
  ) {
    c.header('Cache-Control', 'no-store, private');
  }

  c.header('X-Request-Id', c.get('requestId'));
});

app.use(
  '/api/*',
  bodyLimit({
    maxSize: 65536,
    onError: c =>
      c.json(
        {
          error: {
            code: 'body_too_large',
            message: 'Conteúdo muito grande.'
          }
        },
        413
      )
  })
);

app.use('/api/*', async (c, next) => {
  if (
    !c.env.AUTH_PEPPER ||
    !/^[a-f0-9]{64}$/.test(c.env.DATA_KEY || '') ||
    c.env.AUTH_PEPPER.length < 32
  ) {
    throw new ApiError(
      503,
      'configuration_required',
      'Configure os segredos AUTH_PEPPER e DATA_KEY antes de usar o sistema.'
    );
  }

  if (
    c.env.ENVIRONMENT === 'production' &&
    (
      !/^https:\/\/[^/]+$/.test(c.env.APP_ORIGIN || '') ||
      c.env.APP_ORIGIN.endsWith('.invalid')
    )
  ) {
    throw new ApiError(
      503,
      'configuration_required',
      'APP_ORIGIN deve ser a origem HTTPS do aplicativo, sem barra final.'
    );
  }

  await next();
});

app.use('/api/*', originGuard);

app.get('/api/health', async c => {
  await c.get('db').prepare('SELECT 1').first();

  return c.json({
    status: 'ok',
    database: 'D1',
    environment: c.env.ENVIRONMENT
  });
});

// Autenticacao
app.route('/api', authRoutes);

// Rotas dos funcionarios
app.route('/api/employee', employeeRoutes);

// Termometro de Humor - funcionario
app.route('/api/employee', employeeMoodRoutes);

// Rotas administrativas
const admin = new Hono<App>();

admin.use('*', auth('admin'));
admin.route('/', adminEmployees);
admin.route('/', adminOperations);

// Termometro de Humor - administrador
admin.route('/', adminMoodRoutes);

app.route('/api/admin', admin);

app.all('/api/*', c =>
  c.json(
    {
      error: {
        code: 'not_found',
        message: 'Operação não encontrada.'
      }
    },
    404
  )
);

app.get('*', async c => {
  const path = c.req.path;

  if (
    c.env.ENVIRONMENT === 'production' &&
    c.env.APP_ORIGIN &&
    !c.env.APP_ORIGIN.endsWith('.invalid') &&
    new URL(c.req.url).origin !== c.env.APP_ORIGIN
  ) {
    const target = new URL(c.env.APP_ORIGIN);
    target.pathname = path;
    target.search = new URL(c.req.url).search;

    return c.redirect(target.toString(), 302);
  }

  if (
    (path === '/admin' || path.startsWith('/admin/')) &&
    path !== '/admin/entrar'
  ) {
    const user = await getPrincipal(c, 'admin');

    if (!user) {
      return c.redirect('/admin/entrar', 302);
    }
  }

  if (path === '/app' || path.startsWith('/app/')) {
    const user = await getPrincipal(c, 'employee');

    if (!user) {
      return c.redirect('/entrar', 302);
    }
  }

  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          fields: error.fields
        },
        requestId: c.get('requestId')
      },
      error.status as any
    );
  }

  const text = String(error.message);

  const conflicts: [string, string, string][] = [
    [
      'period_closed',
      'period_closed',
      'O período está fechado. Um administrador deve reabri-lo com justificativa.'
    ],
    [
      'invalid_sequence',
      'invalid_sequence',
      'Este registro já foi realizado ou está fora da sequência. Atualize a tela para conferir.'
    ],
    [
      'non_monotonic_time',
      'invalid_sequence',
      'A ordem dos horários é inválida. Confira os registros.'
    ],
    [
      'day_adjusted',
      'day_adjusted',
      'Este dia foi ajustado pelo administrador e não aceita novas marcações comuns.'
    ],
    [
      'concurrent_modification',
      'concurrent_modification',
      'Os dados mudaram durante a operação. Atualize a tela e tente novamente.'
    ],
    [
      'setup_completed',
      'setup_completed',
      'A configuração inicial já foi concluída.'
    ],
    [
      'last_admin',
      'last_admin',
      'É obrigatório manter pelo menos um administrador ativo.'
    ],
    [
      'UNIQUE constraint failed',
      'duplicate',
      'Matrícula, usuário, e-mail, data de vigência ou registro já existente. Confira os dados.'
    ],
    [
      'immutable',
      'immutable',
      'Este registro é imutável. Utilize uma nova versão ou um ajuste justificado.'
    ]
  ];

  const conflict = conflicts.find(
    ([needle]) => text.includes(needle)
  );

  if (conflict) {
    return c.json(
      {
        error: {
          code: conflict[1],
          message: conflict[2]
        },
        requestId: c.get('requestId')
      },
      409
    );
  }

  if (text.includes('FOREIGN KEY constraint')) {
    return c.json(
      {
        error: {
          code: 'invalid_reference',
          message: 'Um dos cadastros referenciados não existe ou foi alterado. Atualize a tela.'
        }
      },
      422
    );
  }

  console.error(
    JSON.stringify({
      requestId: c.get('requestId'),
      error: error.name,
      message: text.slice(0, 400)
    })
  );

  return c.json(
    {
      error: {
        code: 'internal_error',
        message: 'Não foi possível confirmar a operação. Atualize a página ou tente novamente com segurança.'
      },
      requestId: c.get('requestId')
    },
    500
  );
});

export default app;
