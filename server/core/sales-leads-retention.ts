// CR JORNADA — descarte controlado de solicitacoes comerciais antigas.
// Nunca toca em usuarios, funcionarios, jornadas ou registros de ponto.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseLeadRetentionDays(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d{1,2}$/.test(value)) return null;
  const days = Number(value);
  return days >= 30 && days <= 365 ? days : null;
}

export const leadRetentionDeleteSql = [
  'DELETE FROM sales_leads WHERE id IN (',
  'SELECT id FROM sales_leads WHERE created_at < ?',
  'ORDER BY created_at ASC LIMIT ?',
  ')'
].join(' ');

export async function deleteExpiredSalesLeads(
  db: Pick<D1DatabaseSession, 'prepare'>,
  days: number,
  now = Date.now(),
  batchSize = 100
): Promise<number> {
  if (!Number.isInteger(days) || days < 30 || days > 365 ||
      !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('invalid_lead_retention');
  }
  const cutoff = now - days * DAY_MS;
  const result = await db.prepare(leadRetentionDeleteSql)
    .bind(cutoff, batchSize).run();
  return result.meta.changes || 0;
}
