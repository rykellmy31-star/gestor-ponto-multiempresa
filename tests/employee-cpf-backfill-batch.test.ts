
import { describe, expect, it } from 'vitest';

import {
  prepareEmployeeCpfImportBatch
} from '../server/core/employee-cpf-backfill-batch';

import type {
  CpfBackfillAnalysis
} from '../server/core/employee-cpf-backfill-conflicts';

// CR JORNADA - Passo 57.9.23
// Testes da preparacao integral dos lotes CPF.
// Nenhum acesso ao D1 ou banco remoto.

const CPF_A = 'a'.repeat(64);
const CPF_B = 'b'.repeat(64);

function analysis(
  items: CpfBackfillAnalysis['approved']
): CpfBackfillAnalysis {
  return {
    ready: true,
    approved: items,
    rejected: [],
    conflicts: []
  };
}

const validItems = [
  {
    employee_id: 'employee-a',
    company_id: 'company-a',
    cpf_lookup_key: CPF_A
  },
  {
    employee_id: 'employee-b',
    company_id: 'company-b',
    cpf_lookup_key: CPF_A
  }
];

describe('CR JORNADA - lotes seguros de CPF', () => {
  it('prepara lote com funcionarios validos', () => {
    const result = prepareEmployeeCpfImportBatch(
      analysis(validItems)
    );

    expect(result.status).toBe('prepared');
    expect(result.total).toBe(2);
    expect(result.items).toEqual(validItems);
  });

  it('permite mesmo CPF em empresas diferentes', () => {
    const result = prepareEmployeeCpfImportBatch(
      analysis(validItems)
    );

    expect(result.total).toBe(2);
  });

  it('bloqueia lote nao autorizado', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch({
        ...analysis(validItems),
        ready: false
      })
    ).toThrow('cpf_backfill_batch_blocked');
  });

  it('bloqueia lote com registros rejeitados', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch({
        ...analysis(validItems),
        rejected: [
          {
            employee_id: 'employee-c',
            reason: 'missing_company'
          }
        ]
      })
    ).toThrow('cpf_backfill_batch_blocked');
  });

  it('bloqueia lote com conflitos', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch({
        ...analysis(validItems),
        conflicts: [
          {
            employee_id: 'employee-c',
            company_id: 'company-a',
            reason: 'duplicate_company_cpf'
          }
        ]
      })
    ).toThrow('cpf_backfill_batch_blocked');
  });

  it('bloqueia lote vazio', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch(
        analysis([])
      )
    ).toThrow('cpf_backfill_empty_batch');
  });

  it('bloqueia funcionario repetido', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch(
        analysis([
          validItems[0],
          {
            ...validItems[0],
            company_id: 'company-b'
          }
        ])
      )
    ).toThrow('cpf_backfill_duplicate_item');
  });

  it('bloqueia CPF duplicado na mesma empresa', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch(
        analysis([
          validItems[0],
          {
            employee_id: 'employee-c',
            company_id: 'company-a',
            cpf_lookup_key: CPF_A
          }
        ])
      )
    ).toThrow('cpf_backfill_duplicate_item');
  });

  it('rejeita chave HMAC invalida', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch(
        analysis([
          {
            employee_id: 'employee-a',
            company_id: 'company-a',
            cpf_lookup_key: 'cpf-invalido'
          }
        ])
      )
    ).toThrow('cpf_backfill_invalid_item');
  });

  it('rejeita identificador empresarial vazio', () => {
    expect(() =>
      prepareEmployeeCpfImportBatch(
        analysis([
          {
            employee_id: 'employee-a',
            company_id: ' ',
            cpf_lookup_key: CPF_B
          }
        ])
      )
    ).toThrow('cpf_backfill_invalid_item');
  });

  it('nao altera o lote original', () => {
    const input = analysis(validItems);
    const before = JSON.stringify(input);

    prepareEmployeeCpfImportBatch(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});
