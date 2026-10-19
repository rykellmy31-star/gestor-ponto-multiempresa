
import { describe, expect, it } from 'vitest';

import {
  analyzeEmployeeCpfBackfill
} from '../server/core/employee-cpf-backfill-conflicts';

import type {
  EmployeeCpfValidationResult
} from '../server/core/employee-cpf-backfill-validation';

// CR JORNADA - Passo 57.9.20
// Testes de conflitos dos CPFs legados.
//
// Sem CPF real, banco D1 ou acesso remoto.
// Nenhum dado e modificado.

const CPF_A = 'a'.repeat(64);
const CPF_B = 'b'.repeat(64);

function valid(
  employeeId: string,
  companyId: string,
  cpfKey: string
): EmployeeCpfValidationResult {
  return {
    status: 'validated',
    employee_id: employeeId,
    company_id: companyId,
    cpf_lookup_key: cpfKey
  };
}

describe('CR JORNADA - conflitos de CPF legado', () => {
  it('aprova funcionario sem conflito', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A)
    ]);

    expect(result.ready).toBe(true);
    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('permite mesmo CPF em empresas diferentes', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A),
      valid('employee-b', 'company-b', CPF_A)
    ]);

    expect(result.ready).toBe(true);
    expect(result.approved).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it('bloqueia CPF repetido na mesma empresa', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A),
      valid('employee-b', 'company-a', CPF_A)
    ]);

    expect(result.ready).toBe(false);
    expect(result.approved).toHaveLength(0);

    expect(
      result.conflicts.filter(
        item => item.reason === 'duplicate_company_cpf'
      )
    ).toHaveLength(2);
  });

  it('permite CPFs diferentes na mesma empresa', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A),
      valid('employee-b', 'company-a', CPF_B)
    ]);

    expect(result.ready).toBe(true);
    expect(result.approved).toHaveLength(2);
  });

  it('bloqueia funcionario duplicado', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A),
      valid('employee-a', 'company-b', CPF_B)
    ]);

    expect(result.ready).toBe(false);
    expect(result.approved).toHaveLength(0);

    expect(
      result.conflicts.filter(
        item => item.reason === 'duplicate_employee'
      )
    ).toHaveLength(2);
  });

  it('bloqueia identificador HMAC invalido', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', 'cpf-invalido')
    ]);

    expect(result.ready).toBe(false);
    expect(result.approved).toHaveLength(0);

    expect(result.conflicts[0].reason).toBe(
      'invalid_lookup_key'
    );
  });

  it('bloqueia chave HMAC com letras maiusculas', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', 'A'.repeat(64))
    ]);

    expect(result.ready).toBe(false);
    expect(result.conflicts[0].reason).toBe(
      'invalid_lookup_key'
    );
  });

  it('mantem registro rejeitado fora dos aprovados', () => {
    const records: EmployeeCpfValidationResult[] = [
      {
        status: 'rejected',
        employee_id: 'employee-a',
        reason: 'missing_company'
      }
    ];

    const result = analyzeEmployeeCpfBackfill(records);

    expect(result.ready).toBe(false);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toEqual([
      {
        employee_id: 'employee-a',
        reason: 'missing_company'
      }
    ]);
  });

  it('nao libera o lote se houver qualquer conflito', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A),
      valid('employee-b', 'company-b', CPF_B),
      valid('employee-c', 'company-a', CPF_A)
    ]);

    expect(result.ready).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);

    // Mesmo havendo itens individualmente
    // aprovados, o lote nao esta autorizado.
    expect(result.approved).toHaveLength(1);
  });

  it('nao modifica os registros de entrada', () => {
    const records = [
      valid('employee-a', 'company-a', CPF_A),
      valid('employee-b', 'company-b', CPF_B)
    ];

    const original = JSON.stringify(records);

    analyzeEmployeeCpfBackfill(records);

    expect(JSON.stringify(records)).toBe(original);
  });

  it('nao retorna CPF em texto puro', () => {
    const result = analyzeEmployeeCpfBackfill([
      valid('employee-a', 'company-a', CPF_A)
    ]);

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('52998224725');
    expect(serialized).not.toContain('cpf_encrypted');
  });
});
