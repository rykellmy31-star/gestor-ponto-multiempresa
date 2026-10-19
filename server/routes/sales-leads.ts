import { Hono } from 'hono';
import { z } from 'zod';
import type { App, Ctx } from '../types';
import { ensure } from '../core/errors';
import { safeEqual } from '../core/crypto';
import { ipHash, limit } from '../core/security';
import { getPlatformSession } from './platform-auth';
import { salesPageSchema } from '../../shared/sales-page';

export const salesLeadPublicRoutes = new Hono<App>();
export const salesLeadAdminRoutes = new Hono<App>();

export const salesLeadInputSchema = z.object({
  name: z.string().trim().min(3).max(100),
  email: z.email().trim().max(254),
  company: z.string().trim().max(120),
  message: z.string().trim().min(12).max(1000),
  plan_id: z.string().max(50).regex(/^[a-z0-9-]*$/),
  consent: z.literal(true),
  website: z.string().max(200).default('')
}).strict();

async function authorizedAdmin(c: Ctx, csrf = false) {
  const session = await getPlatformSession(c);
  ensure(session, 401, 'unauthenticated',
    'Entre como Superadmin para consultar os interessados.');
  if (csrf) {
    ensure(safeEqual(c.req.header('X-CSRF-Token') || '', session.csrf_token),
      403, 'csrf', 'Token de segurança inválido.');
  }
  return session;
}

salesLeadPublicRoutes.post('/leads', async c => {
  // Limite de requisicoes por IP com HMAC: IP nao e armazenado no cadastro.
  await limit(c, 'public-sales-leads:' + ipHash(c), 5, 60 * 60000);
  const parsed = salesLeadInputSchema.safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_sales_lead',
    'Confira nome, e-mail, mensagem e autorização para contato.');

  // Campo isca contra robos: nao informar se a mensagem foi descartada.
  if (parsed.data.website.trim()) {
    return c.json({ success: true }, 202);
  }

  const row = await c.get('db').prepare([
    'SELECT published,published_json FROM sales_page_settings WHERE id=1'
  ].join(' ')).first<{ published: number; published_json: string | null }>();
  ensure(row?.published === 1 && row.published_json,
    404, 'lead_form_unavailable', 'Solicitações comerciais indisponíveis.');
  const config = salesPageSchema.safeParse(JSON.parse(row.published_json));
  ensure(config.success && config.data.lead_form_enabled === true,
    404, 'lead_form_unavailable', 'Solicitações comerciais indisponíveis.');

  const id = parsed.data.plan_id;
  ensure(!id || config.data.plans.some(plan => plan.id === id),
    400, 'invalid_plan', 'Escolha um plano válido.');
  const now = Date.now();
  await c.get('db').prepare([
    'INSERT INTO sales_leads(',
    'id,name,email,company,message,plan_id,status,consent_at,created_at,updated_at',
    ") VALUES(?,?,?,?,?,?,'new',?,?,?)"
  ].join(' ')).bind(
    crypto.randomUUID(), parsed.data.name, parsed.data.email.toLowerCase(),
    parsed.data.company, parsed.data.message, id, now, now, now
  ).run();

  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true }, 201);
});

// A lista de interessados e confidencial: somente Superadmin autenticado.
salesLeadAdminRoutes.get('/', async c => {
  await authorizedAdmin(c);
  const items = await c.get('db').prepare([
    'SELECT id,name,email,company,message,plan_id,status,created_at',
    'FROM sales_leads ORDER BY created_at DESC LIMIT 100'
  ].join(' ')).all<{
    id: string; name: string; email: string; company: string;
    message: string; plan_id: string; status: string; created_at: number;
  }>();
  c.header('Cache-Control', 'private, no-store');
  return c.json({ leads: items.results || [] });
});

salesLeadAdminRoutes.patch('/:id', async c => {
  await authorizedAdmin(c, true);
  const id = c.req.param('id');
  ensure(/^[0-9a-f-]{36}$/.test(id), 400, 'invalid_lead', 'Solicitação inválida.');
  const parsed = z.object({
    status: z.enum(['new', 'contacted', 'closed'])
  }).strict().safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_status', 'Situação inválida.');
  const updated = await c.get('db').prepare(
    'UPDATE sales_leads SET status=?,updated_at=? WHERE id=?'
  ).bind(parsed.data.status, Date.now(), id).run();
  ensure(updated.meta.changes === 1, 404, 'lead_not_found', 'Solicitação não encontrada.');
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true });
});

salesLeadAdminRoutes.delete('/:id', async c => {
  await authorizedAdmin(c, true);
  const id = c.req.param('id');
  ensure(/^[0-9a-f-]{36}$/.test(id), 400, 'invalid_lead', 'Solicitação inválida.');
  const removed = await c.get('db').prepare(
    'DELETE FROM sales_leads WHERE id=?'
  ).bind(id).run();
  ensure(removed.meta.changes === 1, 404, 'lead_not_found', 'Solicitação não encontrada.');
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true });
});
