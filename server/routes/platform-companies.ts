import { companyLogoSchema,decodeCompanyLogo,COMPANY_LOGO_PATH } from '../../shared/company-logo';
import { sha256 } from '../core/crypto';
import { companyAdminWrite } from '../core/company-admin-write';

import { Hono } from 'hono';
import { z } from 'zod';

import type { App, Ctx } from '../types';
import { ensure, ApiError } from '../core/errors';
import { hashPassword, randomToken, safeEqual } from '../core/crypto';
import { login as loginSchema, password as passwordSchema } from '../core/validation';
import { ipHash, limit } from '../core/security';
import { getPlatformSession } from './platform-auth';

export const platformCompaniesRoutes = new Hono<App>();

const companySchema = z.object({
  name: z.string().trim().min(2).max(150),
  document: z.string().trim().max(30).default(''),
  slug: z.string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(60),
  logo_url: companyLogoSchema,
  primary_color: z.string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#0F766E'),
  timezone: z.enum([
    'America/Bahia',
    'America/Sao_Paulo'
  ]).default('America/Bahia')
}).strict();

const statusSchema = z.object({
  status: z.enum(['active', 'suspended'])
}).strict();

type CompanyRow = {
  id: string;
  name: string;
  document: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  timezone: string;
  status: string;
  created_at: number;
  updated_at: number;
};

async function requirePlatformAdmin(
  c: Ctx,
  checkCsrf = false
) {
  const session = await getPlatformSession(c);

  ensure(
    session,
    401,
    'unauthenticated',
    'Entre como Superadministrador.'
  );

  if (checkCsrf) {
    ensure(
      safeEqual(
        c.req.header('X-CSRF-Token') || '',
        session.csrf_token
      ),
      403,
      'csrf',
      'Solicitação de segurança inválida.'
    );
  }

  // O Superadmin pode ficar usando a lista e o cadastro de empresas
  // sem consultar /auth/session. Essas ações autenticadas também
  // contam como atividade para o limite de 30 minutos de inatividade.
  // Requisições de escrita com CSRF inválido não renovam a sessão.
  const now = Date.now();
  if (now - session.last_seen_at > 60000) {
    await c.get('db').prepare(`
      UPDATE platform_sessions
      SET last_seen_at = ?
      WHERE token_hash = ?
        AND expires_at > ?
        AND last_seen_at > ?
    `).bind(now, session.tokenHash, now, now - 30 * 60000).run();
  }

  return session;
}

async function recordAudit(
  c: Ctx,
  actorId: string,
  action: string,
  companyId: string,
  details: unknown
) {
  await c.get('db').prepare(`
    INSERT INTO platform_audit_log (
      id,
      actor_id,
      action,
      entity_type,
      entity_id,
      details_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    actorId,
    action,
    'company',
    companyId,
    JSON.stringify(details),
    Date.now()
  ).run();
}

function exposeLogo<T extends {id:string;logo_url:string|null}>(company:T):T {
  return {...company,logo_url:company.logo_url?.startsWith('data:')
    ?'/api/platform/companies/'+company.id+'/logo/'+sha256(company.logo_url):company.logo_url};
}
platformCompaniesRoutes.get('/:id/logo/:hash',async c=>{
  await requirePlatformAdmin(c);
  const row=await c.get('db').prepare('SELECT logo_url FROM companies WHERE id=?').bind(c.req.param('id')).first<{logo_url:string|null}>();
  ensure(row?.logo_url&&sha256(row.logo_url)===c.req.param('hash'),404,'logo_not_found','Logomarca não encontrada.');
  const image=decodeCompanyLogo(row.logo_url);ensure(image,404,'logo_not_found','Logomarca não encontrada.');
  c.header('Content-Type',image.type);c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');
  return c.body(new Uint8Array(image.bytes).buffer);
});

// Listar empresas cadastradas.
platformCompaniesRoutes.get('/', async c => {
  await requirePlatformAdmin(c);

  const result = await c.get('db').prepare(`
    SELECT
      id, name, document, slug, logo_url,
      primary_color, timezone, status,
      created_at, updated_at
    FROM companies
    ORDER BY created_at DESC
    LIMIT 500
  `).all<CompanyRow>();

  return c.json({
    companies: (result.results || []).map(exposeLogo)
  });
});

// Cadastrar uma nova empresa.
platformCompaniesRoutes.post('/', async c => {
  const admin = await requirePlatformAdmin(c, true);

  const parsed = companySchema.safeParse(
    await c.req.json().catch(() => null)
  );

  ensure(
    parsed.success,
    400,
    'invalid_company',
    'Confira os dados informados.'
  );

  const data = parsed.data;
  ensure(!data.logo_url||!COMPANY_LOGO_PATH.test(data.logo_url),400,'invalid_logo','Envie uma imagem ou URL válida para a nova empresa.');
  const db = c.get('db');

  const existing = await db.prepare(`
    SELECT id FROM companies
    WHERE slug = ? COLLATE NOCASE
    LIMIT 1
  `).bind(data.slug).first();

  ensure(
    !existing,
    409,
    'duplicate_slug',
    'Esse endereço de empresa já está em uso.'
  );

  const id = crypto.randomUUID();
  const now = Date.now();

  const statements = [
    db.prepare(`
      INSERT INTO companies (
        id, name, document, slug,
        logo_url, primary_color, timezone,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(
      id,
      data.name,
      data.document,
      data.slug,
      data.logo_url || null,
      data.primary_color,
      data.timezone,
      now,
      now
    ),
    db.prepare(`
      INSERT INTO platform_audit_log (
        id, actor_id, action, entity_type,
        entity_id, details_json, created_at
      ) VALUES (?, ?, ?, 'company', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      admin.id,
      'company.created',
      id,
      JSON.stringify({
        name: data.name,
        slug: data.slug
      }),
      now
    )
  ];

  await db.batch(statements);

  return c.json({
    success: true,
    company: exposeLogo({
      id,
      ...data,
      logo_url: data.logo_url || null,
      status: 'active',
      created_at: now,
      updated_at: now
    })
  }, 201);
});

// Consultar uma empresa.
platformCompaniesRoutes.get('/:id', async c => {
  await requirePlatformAdmin(c);

  const company = await c.get('db').prepare(`
    SELECT
      id, name, document, slug, logo_url,
      primary_color, timezone, status,
      created_at, updated_at
    FROM companies
    WHERE id = ?
  `).bind(c.req.param('id')).first<CompanyRow>();

  ensure(
    company,
    404,
    'company_not_found',
    'Empresa não encontrada.'
  );

  return c.json({ company:exposeLogo(company) });
});

// Atualizar dados de uma empresa.
platformCompaniesRoutes.put('/:id', async c => {
  const admin = await requirePlatformAdmin(c, true);
  const id = c.req.param('id');

  const parsed = companySchema.safeParse(
    await c.req.json().catch(() => null)
  );

  ensure(
    parsed.success,
    400,
    'invalid_company',
    'Confira os dados informados.'
  );

  const data = parsed.data;
  const db = c.get('db');

  const existing = await db.prepare(`
    SELECT id, status, updated_at,logo_url FROM companies WHERE id = ?
  `).bind(id).first<{
    id: string; status: string; updated_at: number;logo_url:string|null
  }>();

  ensure(
    existing,
    404,
    'company_not_found',
    'Empresa não encontrada.'
  );
  ensure(existing.status !== 'archived', 409, 'company_archived',
    'Uma empresa arquivada não pode ser alterada.');
  if(data.logo_url&&COMPANY_LOGO_PATH.test(data.logo_url)){
    ensure(existing.logo_url?.startsWith('data:')&&exposeLogo({id,logo_url:existing.logo_url}).logo_url===data.logo_url,
      400,'invalid_logo','A logomarca não corresponde a esta empresa. Envie a imagem novamente.');
    data.logo_url=existing.logo_url;
  }


  const duplicate = await db.prepare(`
    SELECT id FROM companies
    WHERE slug = ? COLLATE NOCASE AND id != ?
    LIMIT 1
  `).bind(data.slug, id).first();

  ensure(
    !duplicate,
    409,
    'duplicate_slug',
    'Esse endereço de empresa já está em uso.'
  );

  const now = Date.now();

  // A guarda SQL torna a edicao e a auditoria atomicas. Se outra
  // requisicao suspendeu/arquivou/alterou a empresa depois do SELECT,
  // nenhum dado nem evento de auditoria parcial deve ser gravado.
  await companyAdminWrite(db, [
    db.prepare(`
      UPDATE companies
      SET
        name = ?,
        document = ?,
        slug = ?,
        logo_url = ?,
        primary_color = ?,
        timezone = ?,
        updated_at = ?
      WHERE id = ? AND status = ? AND updated_at = ?
        AND status != 'archived'
    `).bind(
      data.name,
      data.document,
      data.slug,
      data.logo_url || null,
      data.primary_color,
      data.timezone,
      now,
      id, existing.status, existing.updated_at
    ),
    db.prepare(`
      INSERT INTO platform_audit_log (
        id, actor_id, action, entity_type,
        entity_id, details_json, created_at
      ) VALUES (?, ?, ?, 'company', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      admin.id,
      'company.updated',
      id,
      JSON.stringify({
        name: data.name,
        slug: data.slug
      }),
      now
    )
  ], 'company_edit_conflict');

  c.header('Cache-Control','private, no-store');
  return c.json({ success: true });
});

// Ativar ou suspender empresa.
platformCompaniesRoutes.patch('/:id/status', async c => {
  const admin = await requirePlatformAdmin(c, true);
  const id = c.req.param('id');

  const parsed = statusSchema.safeParse(
    await c.req.json().catch(() => null)
  );

  ensure(
    parsed.success,
    400,
    'invalid_status',
    'Situação inválida.'
  );

  const db = c.get('db');

  const existing = await db.prepare(`
    SELECT id, status
    FROM companies
    WHERE id = ?
  `).bind(id).first<{
    id: string;
    status: string;
  }>();

  ensure(
    existing,
    404,
    'company_not_found',
    'Empresa não encontrada.'
  );

  ensure(
    existing.status !== 'archived',
    409,
    'company_archived',
    'Uma empresa arquivada não pode ser alterada.'
  );

  // Repetir a mesma transição não modifica updated_at, não produz um
  // evento fictício de status_changed e não mexe nas sessões.
  if (existing.status === parsed.data.status) {
    c.header('Cache-Control', 'private, no-store');
    return c.json({
      success: true,
      status: existing.status,
      unchanged: true
    });
  }

  const now = Date.now();

  // Uma empresa suspensa nao pode recuperar sessoes antigas ao ser
  // reativada. Revogar administradores e funcionarios NO MESMO batch
  // da alteracao de status, sem tocar nas sessoes de outras empresas.
  // A guarda otimista impede auditar uma transicao que nao aconteceu.
  const statements:D1PreparedStatement[] = [
    db.prepare(`
      UPDATE companies
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = ? AND status != 'archived'
    `).bind(parsed.data.status, now, id, existing.status)
  ];
  if (parsed.data.status === 'suspended') {
    statements.push(
      db.prepare('DELETE FROM company_admin_sessions WHERE company_id = ?')
        .bind(id),
      db.prepare('DELETE FROM employee_company_sessions WHERE company_id = ?')
        .bind(id)
    );
  }
  statements.push(db.prepare(`
    INSERT INTO platform_audit_log (
      id, actor_id, action, entity_type,
      entity_id, details_json, created_at
    ) VALUES (?, ?, ?, 'company', ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    admin.id,
    'company.status_changed',
    id,
    JSON.stringify({
      previous_status: existing.status,
      new_status: parsed.data.status
    }),
    now
  ));
  await companyAdminWrite(db, statements, 'company_status_conflict');

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    success: true,
    status: parsed.data.status
  });
});


// CR JORNADA: cadastro de administradores vinculados a uma empresa.
// A autenticação destes administradores será habilitada apenas após
// a implementação e os testes do isolamento por company_id.
const companyAdminSchema = z.object({
  name: z.string().trim().min(3).max(140),
  login: loginSchema,
  email: z.union([z.email(), z.literal('')]),
  password: passwordSchema
}).strict();

platformCompaniesRoutes.get('/:id/admins', async c => {
  await requirePlatformAdmin(c);
  const companyId = c.req.param('id');
  const company = await c.get('db').prepare('SELECT id FROM companies WHERE id = ?')
    .bind(companyId).first();
  ensure(company, 404, 'company_not_found', 'Empresa não encontrada.');
  const result = await c.get('db').prepare(`
    SELECT id, company_id, login, email, display_name, active, created_at, updated_at
    FROM company_admins WHERE company_id = ? ORDER BY created_at DESC LIMIT 100
  `).bind(companyId).all();
  return c.json({ admins: result.results || [] });
});

platformCompaniesRoutes.post('/:id/admins', async c => {
  const admin = await requirePlatformAdmin(c, true);
  await limit(c, `company-admin-create:${admin.id}:${ipHash(c)}`, 15, 3600000);
  const companyId = c.req.param('id');
  const parsed = companyAdminSchema.safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_company_admin', 'Confira os dados do administrador.');
  const data = parsed.data;
  const db = c.get('db');
  const company = await db.prepare('SELECT id, status FROM companies WHERE id = ?')
    .bind(companyId).first<{ id: string; status: string }>();
  ensure(company, 404, 'company_not_found', 'Empresa não encontrada.');
  ensure(company.status === 'active', 409, 'company_inactive', 'A empresa precisa estar ativa.');
  const id = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = await hashPassword(data.password, c.env.AUTH_PEPPER);
  // SELECT do estado ativo dentro da gravacao fecha a janela entre a
  // verificacao anterior e o INSERT. A guarda changes() aborta o batch
  // inteiro (inclusive auditoria) se a empresa for suspensa no meio.
  try {
    await companyAdminWrite(db, [
      db.prepare(`INSERT INTO company_admins
        (id, company_id, login, email, display_name, password_hash,
         active, auth_version, created_at, updated_at)
        SELECT ?, co.id, ?, ?, ?, ?, 1, 0, ?, ?
        FROM companies co WHERE co.id=? AND co.status='active'`)
        .bind(id, data.login, data.email.toLowerCase() || null,
          data.name, passwordHash, now, now, companyId),
      db.prepare(`INSERT INTO platform_audit_log
        (id, actor_id, action, entity_type, entity_id, details_json, created_at)
        VALUES (?, ?, 'company_admin.created', 'company_admin', ?, ?, ?)`)
        .bind(crypto.randomUUID(), admin.id, id,
          JSON.stringify({ company_id: companyId, login: data.login }), now)
    ], 'company_admin_create_conflict');
  } catch (error) {
    // Identificadores unicos sao por EMPRESA. Uma disputa concorrente de
    // cadastro deve devolver 409 e nunca expor SQL, hash ou senha.
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: company_admins\./i.test(message)) {
      throw new ApiError(409, 'company_admin_already_exists',
        'Este usuário ou e-mail já está cadastrado nesta empresa.');
    }
    throw error;
  }
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, admin: {
    id, company_id: companyId, login: data.login,
    email: data.email.toLowerCase() || null,
    display_name: data.name, active: 1, created_at: now, updated_at: now
  } }, 201);
});


// Bloqueio imediato de acesso a empresa, inclusive nas sessoes emitidas.
// A alteracao nao toca administradores de outras empresas.
const adminStatusSchema = z.object({
  active: z.boolean()
}).strict();

platformCompaniesRoutes.patch('/:id/admins/:adminId/status', async c => {
  const platformAdmin = await requirePlatformAdmin(c, true);
  await limit(c, 'company-admin-status:' + platformAdmin.id + ':' + ipHash(c),
    30, 3600000);
  const companyId = c.req.param('id');
  const adminId = c.req.param('adminId');
  const parsed = adminStatusSchema.safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_admin_status', 'Situação inválida.');

  const db = c.get('db');
  const row = await db.prepare([
    'SELECT a.id,a.active,co.status AS company_status FROM company_admins a',
    'JOIN companies co ON co.id=a.company_id',
    'WHERE a.id=? AND a.company_id=?'
  ].join(' ')).bind(adminId, companyId).first<{
    id: string; active: number; company_status: string
  }>();

  ensure(row, 404, 'company_admin_not_found',
    'Administrador não encontrado nesta empresa.');
  ensure(row.company_status !== 'archived', 409, 'company_archived',
    'A empresa arquivada não pode ser alterada.');
  ensure(!parsed.data.active || row.company_status === 'active',
    409, 'company_inactive', 'Ative a empresa antes de liberar um administrador.');

  const active = parsed.data.active ? 1 : 0;
  if (row.active === active) {
    return c.json({ success: true, active: !!active, unchanged: true });
  }

  const now = Date.now();
  const results = await companyAdminWrite(db, [
    db.prepare([
      'UPDATE company_admins',
      'SET active=?,auth_version=auth_version+1,updated_at=?',
      'WHERE id=? AND company_id=? AND active=?',
      "AND EXISTS (SELECT 1 FROM companies WHERE id=company_admins.company_id",
      "AND status!='archived' AND (?=0 OR status='active'))"
    ].join(' ')).bind(active, now, adminId, companyId, row.active, active),
    db.prepare([
      'DELETE FROM company_admin_sessions',
      'WHERE admin_id=? AND company_id=?'
    ].join(' ')).bind(adminId, companyId),
    db.prepare([
      'INSERT INTO platform_audit_log',
      '(id,actor_id,action,entity_type,entity_id,details_json,created_at)',
      "VALUES (?,?,'company_admin.status_changed','company_admin',?,?,?)"
    ].join(' ')).bind(crypto.randomUUID(), platformAdmin.id, adminId,
      JSON.stringify({ company_id: companyId, previous_active: !!row.active,
        active: !!active }), now)
  ], 'company_admin_conflict');
  ensure(results[0].meta.changes === 1, 409, 'company_admin_conflict',
    'O administrador foi alterado. Atualize a lista.');
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, active: !!active });
});


// Recuperação assistida: somente o Superadmin autenticado pode gerar uma nova
// senha provisória para gestor da MESMA empresa. Exibida uma única vez,
// jamais armazenada em texto claro, enviada por email ou gravada em auditoria.
platformCompaniesRoutes.post('/:id/admins/:adminId/reset-password', async c => {
  const platformAdmin = await requirePlatformAdmin(c, true);
  await limit(c,
    'company-admin-reset:' + platformAdmin.id + ':' + ipHash(c),
    10, 3600000
  );
  const companyId = c.req.param('id');
  const adminId = c.req.param('adminId');
  const db = c.get('db');
  const manager = await db.prepare([
    'SELECT a.id,a.active,a.auth_version,co.status AS company_status',
    'FROM company_admins a',
    'JOIN companies co ON co.id=a.company_id',
    'WHERE a.id=? AND a.company_id=?'
  ].join(' ')).bind(adminId, companyId).first<{
    id:string;active:number;auth_version:number;company_status:string
  }>();

  ensure(manager, 404, 'company_admin_not_found',
    'Administrador não encontrado nesta empresa.');
  ensure(manager.company_status === 'active', 409, 'company_inactive',
    'Ative a empresa antes de redefinir senhas.');
  ensure(manager.active === 1, 409, 'company_admin_inactive',
    'Reative o administrador antes de redefinir sua senha.');

  // 96 bits de entropia gerados no servidor. Válido por somente 24 horas.
  const temporaryPassword = randomToken().slice(0, 24);
  const hashed = await hashPassword(temporaryPassword, c.env.AUTH_PEPPER);
  const now = Date.now();
  const expiresAt = now + 24 * 3600000;

  const result = await companyAdminWrite(db, [
    db.prepare([
      'UPDATE company_admins SET password_hash=?,',
      'must_change_password=1,temporary_password_expires_at=?,',
      'auth_version=auth_version+1,updated_at=?',
      'WHERE id=? AND company_id=? AND active=1 AND auth_version=?',
      "AND EXISTS (SELECT 1 FROM companies WHERE id=company_admins.company_id AND status='active')"
    ].join(' ')).bind(hashed,expiresAt,now,adminId,companyId,
      manager.auth_version),
    db.prepare([
      'DELETE FROM company_admin_sessions',
      'WHERE admin_id=? AND company_id=?'
    ].join(' ')).bind(adminId,companyId),
    db.prepare([
      'INSERT INTO platform_audit_log',
      '(id,actor_id,action,entity_type,entity_id,details_json,created_at)',
      "VALUES (?,?,'company_admin.password_reset','company_admin',?,?,?)"
    ].join(' ')).bind(crypto.randomUUID(),platformAdmin.id,adminId,
      JSON.stringify({company_id:companyId,expires_at:expiresAt}),now)
  ], 'company_admin_conflict');

  ensure(result[0].meta.changes === 1, 409, 'company_admin_conflict',
    'O administrador foi alterado. Atualize a lista e tente novamente.');

  c.header('Cache-Control','private, no-store');
  c.header('Pragma','no-cache');
  return c.json({
    success:true,
    temporary_password:temporaryPassword,
    expires_at:expiresAt,
    must_change_password:true
  });
});
