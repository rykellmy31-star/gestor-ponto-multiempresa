import { describe, expect, it } from 'vitest';
import {
  parseLeadRetentionDays,
  deleteExpiredSalesLeads,
  leadRetentionDeleteSql
} from '../server/core/sales-leads-retention';

describe('CR JORNADA — descarte restrito de contatos comerciais', () => {
  it('exige periodo explicito entre 30 e 365 dias', () => {
    for (const value of [undefined, '', '0', '29', '366', '90.5', '090',
      '-90', 'abc', ' 90 ', '999999', '1e2']) {
      expect(parseLeadRetentionDays(value)).toBe(null);
    }
    expect(parseLeadRetentionDays('30')).toBe(30);
    expect(parseLeadRetentionDays('90')).toBe(90);
    expect(parseLeadRetentionDays('365')).toBe(365);
  });

  it('filtra exclusivamente contatos antigos por created_at, em lotes', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        const st = {
          bind(...params: unknown[]) {
            calls.push({ sql, params });
            return st;
          },
          async run() {
            return { meta: { changes: 3 } };
          }
        };
        return st;
      }
    };
    const now = Date.UTC(2026, 9, 19);
    const count = await deleteExpiredSalesLeads(db as any, 90, now, 100);
    expect(count).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe(leadRetentionDeleteSql);
    expect(calls[0].sql).toContain('FROM sales_leads');
    expect(calls[0].sql).not.toContain('punches');
    expect(calls[0].sql).not.toContain('employees');
    expect(calls[0].params).toEqual([
      now - 90 * 86400000, 100
    ]);
  });

  it('bloqueia limites perigosos sem executar SQL', async () => {
    let invoked = false;
    const db = { prepare() { invoked = true; throw new Error('should not run'); } };
    for (const [days, batch] of [[0, 100],[366,100],[90,0],[90,501],[90.5,100]]) {
      await expect(deleteExpiredSalesLeads(
        db as any, days, Date.now(), batch
      )).rejects.toThrow(/invalid_lead_retention/);
    }
    expect(invoked).toBe(false);
  });
});
