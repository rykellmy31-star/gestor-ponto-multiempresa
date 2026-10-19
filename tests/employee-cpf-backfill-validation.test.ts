
import { describe, expect, it, vi } from 'vitest';

import {
  validateEmployeeCpfBackfill
} from '../server/core/employee-cpf-backfill-validation';

import type {
  EmployeeCpfBackfillRecord
} from '../server/core/employee-cpf-backfill';

// CR JORNADA - Passo 57.9.18
// Testes da validacao de CPFs legados.
//
// Sem D1, deploy ou operacoes remotas.
// Sem descriptografia real.
// Sem segredos de producao.

const TEST_SECRET =
  'cr-jornada-cpf-backfill-test-secret-2026';

const employee: EmployeeCpfBackfillRecord = {
  id: 'employee-a',
  company_id: 'company-a',
  cpf_encrypted: 'encrypted-test-value',
  deleted_at: null,
  employee_status: 'active',
  company_status: 'active'
};

// CPF matematicamente valido usado apenas
// como dado ficticio de teste.
const VALID_CPF = '52998224725';

const decrypt = vi.fn(async (_encrypted: string) =>
  VALID_CPF
);

describe('CR JORNADA - validacao de CPF legado', () => {
  it('valida CPF e gera identificador protegido', async () => {
    const result = await validateEmployeeCpfBackfill(
      employee,
      TEST_SECRET,
      async () => VALID_CPF
    );

    expect(result.status).toBe('validated');

    if (result.status === 'validated') {
      expect(result.employee_id).toBe('employee-a');
      expect(result.company_id).toBe('company-a');
      expect(result.cpf_lookup_key).toMatch(
        /^[a-f0-9]{64}$/
      );
      expect(result.cpf_lookup_key).not.toContain(
        VALID_CPF
      );
    }
  });

  it('normaliza diferentes formatos de CPF', async () => {
    const first = await validateEmployeeCpfBackfill(
      employee,
      TEST_SECRET,
      async () => '529.982.247-25'
    );

    const second = await validateEmployeeCpfBackfill(
      employee,
      TEST_SECRET,
      async () => VALID_CPF
    );

    expect(first.status).toBe('validated');
    expect(second.status).toBe('validated');

    if (
      first.status === 'validated' &&
      second.status === 'validated'
    ) {
      expect(first.cpf_lookup_key).toBe(
        second.cpf_lookup_key
      );
    }
  });

  it('rejeita CPF invalido', async () => {
    const result = await validateEmployeeCpfBackfill(
      employee,
      TEST_SECRET,
      async () => '12345678900'
    );

    expect(result).toEqual({
      status: 'rejected',
      employee_id: 'employee-a',
      reason: 'invalid_cpf'
    });
  });

  it('rejeita falha de descriptografia', async () => {
    const result = await validateEmployeeCpfBackfill(
      employee,
      TEST_SECRET,
      async () => {
        throw new Error('erro-interno-sensivel');
      }
    );

    expect(result).toEqual({
      status: 'rejected',
      employee_id: 'employee-a',
      reason: 'decryption_failed'
    });

    expect(JSON.stringify(result)).not.toContain(
      'erro-interno-sensivel'
    );
  });

  it('bloqueia funcionario sem empresa', async () => {
    const result = await validateEmployeeCpfBackfill(
      { ...employee, company_id: null },
      TEST_SECRET,
      async () => VALID_CPF
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'missing_company'
    });
  });

  it('bloqueia funcionario arquivado', async () => {
    const result = await validateEmployeeCpfBackfill(
      {
        ...employee,
        deleted_at: 1760000000000
      },
      TEST_SECRET,
      async () => VALID_CPF
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'archived_employee'
    });
  });

  it('bloqueia empresa inativa', async () => {
    const result = await validateEmployeeCpfBackfill(
      {
        ...employee,
        company_status: 'inactive'
      },
      TEST_SECRET,
      async () => VALID_CPF
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'inactive_company'
    });
  });

  it('rejeita chave secreta curta', async () => {
    await expect(
      validateEmployeeCpfBackfill(
        employee,
        'chave-curta',
        async () => VALID_CPF
      )
    ).rejects.toThrow('invalid_cpf_lookup_secret');
  });

  it('nao chama descriptografia para registro bloqueado', async () => {
    const mockDecrypt = vi.fn(async () => VALID_CPF);

    const result = await validateEmployeeCpfBackfill(
      { ...employee, deleted_at: 1760000000000 },
      TEST_SECRET,
      mockDecrypt
    );

    expect(result.status).toBe('rejected');
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('nao retorna CPF em texto puro', async () => {
    const result = await validateEmployeeCpfBackfill(
      employee,
      TEST_SECRET,
      decrypt
    );

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(VALID_CPF);
    expect(serialized).not.toContain(
      'encrypted-test-value'
    );
  });
});
