import { describe, expect, it } from 'vitest';
import { companyAdminWrite } from '../server/core/company-admin-write';

function fixture(failure?: Error) {
  const batches: any[][] = [];
  const db = {
    prepare(sql: string) {
      return { sql, bind: (...args: unknown[]) => ({ sql, args }) };
    },
    async batch(statements: any[]) {
      batches.push(statements);
      if (failure) throw failure;
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  return { db: db as unknown as D1DatabaseSession, batches };
}

describe('Mutação empresarial atômica', () => {
  it('verifica changes imediatamente após UPDATE, antes de revogar ou auditar', async () => {
    const t = fixture();
    const update = { sql: 'UPDATE gestor' };
    const revoke = { sql: 'DELETE sessoes' };
    const audit = { sql: 'INSERT auditoria' };
    await companyAdminWrite(t.db, [update, revoke, audit] as any, 'conflict');
    const batch = t.batches[0];
    expect(batch[0]).toBe(update);
    expect(batch[1].sql).toContain('VALUES (?,changes())');
    expect(batch[2].args).toEqual(batch[1].args);
    expect(batch.slice(3)).toEqual([revoke, audit]);
  });

  it('traduz a restrição de concorrência para HTTP 409', async () => {
    const t = fixture(new Error('D1_ERROR: CHECK constraint failed: company_admin_write_conflict'));
    await expect(companyAdminWrite(t.db, [{}] as any, 'password_change_conflict'))
      .rejects.toMatchObject({status: 409, code: 'password_change_conflict'});
  });

  it('preserva falhas inesperadas de banco', async () => {
    const error = new Error('database unavailable');
    const t = fixture(error);
    await expect(companyAdminWrite(t.db, [{}] as any, 'conflict')).rejects.toBe(error);
  });
});
