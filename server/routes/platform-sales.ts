import { Hono } from 'hono';
import { z } from 'zod';
import type { App, Ctx } from '../types';
import { ensure } from '../core/errors';
import { safeEqual } from '../core/crypto';
import { limit } from '../core/security';
import { getPlatformSession } from './platform-auth';
import { defaultSalesPage, salesPageSchema } from '../../shared/sales-page';
import { parseLeadRetentionDays } from '../core/sales-leads-retention';

type SalesRow = {
  draft_json: string;
  published_json: string | null;
  published: number;
  revision: number;
  updated_at: number;
};

const saveSchema = z.object({
  config: salesPageSchema,
  published: z.boolean(),
  expected_revision: z.number().int().min(0)
}).strict();

async function getRow(c: Ctx): Promise<SalesRow | null> {
  return c.get('db').prepare(
    'SELECT draft_json,published_json,published,revision,updated_at FROM sales_page_settings WHERE id=1'
  ).first<SalesRow>();
}

export const salesPublicRoutes = new Hono<App>();
export const platformSalesRoutes = new Hono<App>();

// Publico: so fornece dados explicitamente publicados. Rascunhos jamais vazam.
salesPublicRoutes.get('/sales-page', async c => {
  const row = await getRow(c);
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!row || !row.published || !row.published_json) {
    return c.json({ published: false, config: null });
  }
  const parsed = salesPageSchema.safeParse(JSON.parse(row.published_json));
  ensure(parsed.success, 503, 'sales_page_unavailable',
    'Página comercial temporariamente indisponível.');
  return c.json({
    published: true, config: parsed.data, revision: row.revision,
    updated_at: row.updated_at,
    leads_available: c.env.ENABLE_SALES_LEADS === 'true'
  });
});

platformSalesRoutes.get('/', async c => {
  const session = await getPlatformSession(c);
  ensure(session, 401, 'unauthenticated',
    'Entre como Superadmin para configurar a página de vendas.');
  const row = await getRow(c);
  const config = row
    ? salesPageSchema.safeParse(JSON.parse(row.draft_json))
    : { success: true as const, data: defaultSalesPage };
  ensure(config.success, 503, 'sales_page_invalid',
    'Configuração inválida. Solicite uma revisão antes de publicar.');
  c.header('Cache-Control', 'no-store');
  return c.json({
    config: config.data,
    published: row?.published === 1,
    revision: row?.revision || 0,
    updated_at: row?.updated_at || null
  });
});

// Uma unica operacao salva o rascunho e, se solicitado, publica a nova versao.
// O conteudo publicado permanece intacto ao salvar apenas rascunho.
platformSalesRoutes.put('/', async c => {
  const session = await getPlatformSession(c);
  ensure(session, 401, 'unauthenticated',
    'Entre como Superadmin para publicar sua página.');
  ensure(safeEqual(
    c.req.header('X-CSRF-Token') || '', session.csrf_token
  ), 403, 'csrf', 'Token de segurança inválido.');

  await limit(c, 'platform-sales-update:' + session.id, 25, 60 * 60000);

  const parsed = saveSchema.safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_sales_page',
    'Confira os textos, valores, URLs e dados de contato.');
  const { config, published, expected_revision } = parsed.data;
  ensure(
    !published ||
    Boolean(config.lead_form_enabled || config.whatsapp ||
      config.plans.some(plan => plan.checkout_url)),
    422, 'sales_contact_required',
    'Para publicar, ative o formulário de interesse, configure um contato ou adicione um link externo de compra.'
  );

  ensure(
    !published || !config.lead_form_enabled ||
      Boolean(config.privacy_url),
    422, 'sales_privacy_required',
    'Informe o link HTTPS da política de privacidade antes de publicar o formulário.'
  );
  ensure(
    !published || !config.lead_form_enabled ||
      (c.env.ENABLE_SALES_LEADS === 'true' &&
        parseLeadRetentionDays(c.env.SALES_LEADS_RETENTION_DAYS) !== null),
    422, 'sales_leads_not_ready',
    'O formulário comercial exige ativação e prazo de retenção válido no servidor.'
  );

  // No primeiro cadastro aceita somente revisao 0. Uma aba antiga
  // nunca pode recriar a pagina ignorando expected_revision.
  const now = Date.now();
  const result = await c.get('db').prepare([
    'INSERT INTO sales_page_settings (',
    'id,draft_json,published_json,published,revision,updated_by,updated_at',
    ') SELECT 1,?,?,?,1,?,? WHERE (?=0 OR EXISTS(',
    'SELECT 1 FROM sales_page_settings WHERE id=1))',
    'ON CONFLICT(id) DO UPDATE SET',
    'draft_json=excluded.draft_json,',
    'published_json=CASE WHEN excluded.published=1',
    'THEN excluded.draft_json ELSE sales_page_settings.published_json END,',
    'published=CASE WHEN excluded.published=1',
    'THEN 1 ELSE sales_page_settings.published END,',
    'revision=sales_page_settings.revision+1,',
    'updated_by=excluded.updated_by,updated_at=excluded.updated_at',
    'WHERE sales_page_settings.revision=?'
  ].join(' ')).bind(
    JSON.stringify(config),
    published ? JSON.stringify(config) : null,
    published ? 1 : 0,
    session.id, now, expected_revision, expected_revision
  ).run();

  // id=1 limita o UPSERT a uma linha. A auditoria da migration 0021
  // tambem entra em D1.meta.changes; zero continua sendo conflito real.
  ensure(result.meta.changes >= 1, 409, 'sales_page_conflict',
    'Outra alteração foi salva. Recarregue a configuração antes de tentar novamente.');

  const current = await getRow(c);
  c.header('Cache-Control', 'no-store');
  return c.json({
    success: true, published: current?.published === 1,
    revision: current?.revision || expected_revision + 1,
    updated_at: now
  });
});


// Retirar do ar e acao explicita, independente de salvar um rascunho.
platformSalesRoutes.post('/unpublish', async c => {
  const session = await getPlatformSession(c);
  ensure(session, 401, 'unauthenticated', 'Entre como Superadmin.');
  ensure(safeEqual(
    c.req.header('X-CSRF-Token') || '', session.csrf_token
  ), 403, 'csrf', 'Token de segurança inválido.');
  await limit(c, 'platform-sales-unpublish:' + session.id, 10, 60 * 60000);
  const parsed = z.object({
    expected_revision: z.number().int().min(1)
  }).strict().safeParse(await c.req.json().catch(() => null));
  ensure(parsed.success, 400, 'invalid_sales_page', 'Versão inválida.');

  const now = Date.now();
  const result = await c.get('db').prepare([
    'UPDATE sales_page_settings',
    'SET published=0,revision=revision+1,updated_by=?,updated_at=?',
    'WHERE id=1 AND published=1 AND revision=?'
  ].join(' ')).bind(
    session.id, now, parsed.data.expected_revision
  ).run();

  ensure(result.meta.changes >= 1, 409, 'sales_page_conflict',
    'A página já foi alterada ou retirada do ar. Recarregue antes de continuar.');
  c.header('Cache-Control', 'no-store');
  return c.json({
    success: true, published: false,
    revision: parsed.data.expected_revision + 1
  });
});
