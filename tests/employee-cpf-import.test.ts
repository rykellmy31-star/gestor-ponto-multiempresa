import { describe, expect, it, vi } from 'vitest';
import { importEmployeeCpfBatch as executeCpfImport, INSERT_EMPLOYEE_CPF_LINK_SQL } from '../server/core/employee-cpf-import';
import type { EmployeeCpfImportBatch } from '../server/core/employee-cpf-backfill-batch';

const key = 'a'.repeat(64);
const originals = new Map([
  ['employee-a', 'encrypted-a'],
  ['employee-b', 'encrypted-b']
]);
const importEmployeeCpfBatch = (
  db: D1DatabaseSession,
  batch: EmployeeCpfImportBatch,
  now?: number
) => executeCpfImport(db, batch, originals, now);

const valid: EmployeeCpfImportBatch = {
  status: 'prepared',
  total: 2,
  items: [
    { employee_id: 'employee-a', company_id: 'company-a', cpf_lookup_key: key },
    { employee_id: 'employee-b', company_id: 'company-b', cpf_lookup_key: key }
  ]
};

function mockDatabase() {
  const calls: unknown[][] = [];
  const batch = vi.fn(async (_statements: unknown[]) => []);
  const prepare = vi.fn((_sql: string) => ({
    bind: (...params: unknown[]) => {
      calls.push(params);
      return { params };
    }
  }));
  return {
    db: { prepare, batch } as unknown as D1DatabaseSession,
    calls, batch, prepare
  };
}

describe('CR JORNADA - importacao CPF no D1', () => {
  it('envia todas as insercoes em um unico batch atomico', async () => {
    const { db, calls, batch } = mockDatabase();
    expect(await importEmployeeCpfBatch(db, valid, 1760000000000))
      .toEqual({ inserted: 2 });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      'employee-a', 'employee-a', 'company-a', 'encrypted-a', 'company-a',
      key, 1760000000000, 1760000000000
    ]);
  });

  it('valida a empresa e o funcionario no proprio INSERT', () => {
    expect(INSERT_EMPLOYEE_CPF_LINK_SQL).toMatch(/JOIN companies/i);
    expect(INSERT_EMPLOYEE_CPF_LINK_SQL).toMatch(/e\.deleted_at IS NULL/i);
    expect(INSERT_EMPLOYEE_CPF_LINK_SQL).toMatch(/e\.status = 'active'/i);
    expect(INSERT_EMPLOYEE_CPF_LINK_SQL).toMatch(/c\.status = 'active'/i);
    expect(INSERT_EMPLOYEE_CPF_LINK_SQL).toMatch(/e\\.cpf_encrypted = \\?/i);
    expect(INSERT_EMPLOYEE_CPF_LINK_SQL).not.toMatch(/OR IGNORE|OR REPLACE/i);
  });

  it('bloqueia lote vazio e total errado antes de acessar o banco', async () => {
    const { db, batch } = mockDatabase();
    await expect(importEmployeeCpfBatch(db, {
      status: 'prepared', total: 0, items: []
    })).rejects.toThrow('cpf_import_invalid_batch');
    await expect(importEmployeeCpfBatch(db, {
      ...valid, total: 1
    })).rejects.toThrow('cpf_import_invalid_batch');
    expect(batch).not.toHaveBeenCalled();
  });

  it('bloqueia funcionario duplicado e CPF repetido na mesma empresa', async () => {
    const { db, batch } = mockDatabase();
    const employeeDup = [valid.items[0], { ...valid.items[0], company_id: 'company-b' }];
    const cpfDup = [valid.items[0], { employee_id: 'employee-c', company_id: 'company-a', cpf_lookup_key: key }];
    for (const items of [employeeDup, cpfDup]) {
      await expect(importEmployeeCpfBatch(db, {
        status: 'prepared', total: 2, items
      })).rejects.toThrow('cpf_import_duplicate_item');
    }
    expect(batch).not.toHaveBeenCalled();
  });

  it('bloqueia HMAC incorreto, timestamp invalido e lote excessivo', async () => {
    const { db, batch } = mockDatabase();
    await expect(importEmployeeCpfBatch(db, {
      status: 'prepared', total: 1,
      items: [{ ...valid.items[0], cpf_lookup_key: 'invalido' }]
    })).rejects.toThrow('cpf_import_invalid_item');
    await expect(importEmployeeCpfBatch(db, valid, NaN))
      .rejects.toThrow('cpf_import_invalid_timestamp');
    const items = Array.from({ length: 51 }, (_, i) => ({
      employee_id: 'e-' + i, company_id: 'company-a',
      cpf_lookup_key: i.toString(16).padStart(64, '0')
    }));
    await expect(importEmployeeCpfBatch(db, {
      status: 'prepared', total: items.length, items
    })).rejects.toThrow('cpf_import_invalid_batch');
    expect(batch).not.toHaveBeenCalled();
  });

  it('propaga falha do D1 sem continuar com novas gravacoes', async () => {
    const { db, batch } = mockDatabase();
    batch.mockRejectedValueOnce(new Error('UNIQUE constraint failed'));
    await expect(importEmployeeCpfBatch(db, valid))
      .rejects.toThrow('UNIQUE constraint failed');
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('nao altera o lote recebido', async () => {
    const { db } = mockDatabase();
    const before = JSON.stringify(valid);
    await importEmployeeCpfBatch(db, valid);
    expect(JSON.stringify(valid)).toBe(before);
  });
});
