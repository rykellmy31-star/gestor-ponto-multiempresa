import { describe, expect, it, vi } from 'vitest';
import { encryptPersonal } from '../server/core/crypto';
import { backfillEmployeeCpfLinks } from '../server/core/employee-cpf-backfill-service';

type Row = {
  id: string;
  company_id: string | null;
  cpf_encrypted: string | null;
  deleted_at: number | null;
  employee_status: string;
  company_status: string | null;
};
const key = '9'.repeat(64);
const secret = 'cr-jornada-test-lookup-secret-2026';
const cpf = '52998224725';

function fakeDb(rows: Row[]) {
  const bind = vi.fn((...ids: string[]) => ({
    all: vi.fn(async () => ({
      success: true,
      results: rows.filter(r => ids.includes(r.id))
    }))
  }));
  const writes: unknown[][] = [];
  const batch = vi.fn(async (_stmts: unknown[]) => []);
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM employees e LEFT JOIN companies c')) return { bind };
    return {
      bind: (...args: unknown[]) => {
        writes.push(args);
        return { args };
      }
    };
  });
  return {
    db: { prepare, batch } as unknown as D1DatabaseSession,
    batch, writes, prepare
  };
}

describe('CR JORNADA - orquestracao de CPF legado', () => {
  it('descriptografa, valida e importa dois vinculos de empresas distintas', async () => {
    const encrypted = await encryptPersonal(cpf, key);
    const mock = fakeDb([
      { id: 'a', company_id: 'company-a', cpf_encrypted: encrypted,
        deleted_at: null, employee_status: 'active', company_status: 'active' },
      { id: 'b', company_id: 'company-b', cpf_encrypted: encrypted,
        deleted_at: null, employee_status: 'active', company_status: 'active' }
    ]);
    const result = await backfillEmployeeCpfLinks(
      mock.db, ['a', 'b'], key, secret
    );
    expect(result).toEqual({ inserted: 2 });
    expect(mock.batch).toHaveBeenCalledTimes(1);
    expect(mock.writes).toHaveLength(2);
    expect(mock.writes[0][3]).toBe(encrypted);
    expect(mock.writes[0][5]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(mock.writes)).not.toContain(cpf);
  });

  it('rejeita funcionario ausente sem tentar gravacao parcial', async () => {
    const encrypted = await encryptPersonal(cpf, key);
    const mock = fakeDb([
      { id: 'a', company_id: 'company-a', cpf_encrypted: encrypted,
        deleted_at: null, employee_status: 'active', company_status: 'active' }
    ]);
    await expect(backfillEmployeeCpfLinks(
      mock.db, ['a', 'inexistente'], key, secret
    )).rejects.toThrow('cpf_backfill_selection_changed');
    expect(mock.batch).not.toHaveBeenCalled();
  });

  it('rejeita funcionario arquivado, mesmo com CPF valido', async () => {
    const encrypted = await encryptPersonal(cpf, key);
    const mock = fakeDb([
      { id: 'a', company_id: 'company-a', cpf_encrypted: encrypted,
        deleted_at: 1760000000000, employee_status: 'active', company_status: 'active' }
    ]);
    await expect(backfillEmployeeCpfLinks(
      mock.db, ['a'], key, secret
    )).rejects.toThrow('cpf_backfill_batch_blocked');
    expect(mock.batch).not.toHaveBeenCalled();
  });

  it('impede CPF duplicado na mesma empresa antes da escrita', async () => {
    const encrypted = await encryptPersonal(cpf, key);
    const mock = fakeDb([
      { id: 'a', company_id: 'company-a', cpf_encrypted: encrypted,
        deleted_at: null, employee_status: 'active', company_status: 'active' },
      { id: 'b', company_id: 'company-a', cpf_encrypted: encrypted,
        deleted_at: null, employee_status: 'active', company_status: 'active' }
    ]);
    await expect(backfillEmployeeCpfLinks(
      mock.db, ['a', 'b'], key, secret
    )).rejects.toThrow('cpf_backfill_batch_blocked');
    expect(mock.batch).not.toHaveBeenCalled();
  });

  it('rejeita selecao duplicada e configuracao ausente', async () => {
    const mock = fakeDb([]);
    await expect(backfillEmployeeCpfLinks(
      mock.db, ['a', 'a'], key, secret
    )).rejects.toThrow('cpf_backfill_invalid_selection');
    await expect(backfillEmployeeCpfLinks(
      mock.db, ['a'], 'invalid', secret
    )).rejects.toThrow('cpf_backfill_configuration_required');
    expect(mock.prepare).not.toHaveBeenCalled();
  });
});
