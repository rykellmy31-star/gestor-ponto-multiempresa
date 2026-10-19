
import { describe, expect, it } from 'vitest';

import {
  classifyEmployeeCpfBackfill,
  type EmployeeCpfBackfillRecord
} from '../server/core/employee-cpf-backfill';

// CR JORNADA - Passo 57.9.16
// Testes de classificacao de CPFs legados.
//
// Nao utiliza CPF real.
// Nao descriptografa dados.
// Nao consulta bancos de dados.
// Nao cria contas ou sessoes.

const validEmployee: EmployeeCpfBackfillRecord = {
  id: 'employee-a',
  company_id: 'company-a',
  cpf_encrypted: 'conteudo-criptografado-ficticio',
  deleted_at: null,
  employee_status: 'active',
  company_status: 'active'
};

describe('CR JORNADA - revisao de CPFs legados', () => {
  it('classifica funcionario valido para revisao', () => {
    const result = classifyEmployeeCpfBackfill(
      validEmployee
    );

    expect(result).toEqual({
      status: 'eligible_for_review',
      employee_id: 'employee-a',
      company_id: 'company-a'
    });
  });

  it('bloqueia funcionario sem empresa', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      company_id: null
    });

    expect(result).toEqual({
      status: 'blocked',
      employee_id: 'employee-a',
      reason: 'missing_company'
    });
  });

  it('bloqueia identificador de empresa vazio', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      company_id: '   '
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'missing_company'
    });
  });

  it('bloqueia funcionario sem CPF criptografado', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      cpf_encrypted: null
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'missing_cpf'
    });
  });

  it('bloqueia CPF criptografado vazio', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      cpf_encrypted: '   '
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'missing_cpf'
    });
  });

  it('bloqueia funcionario arquivado', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      deleted_at: 1760000000000
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'archived_employee'
    });
  });

  it('bloqueia funcionario com status bloqueado', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      employee_status: 'blocked'
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inactive_employee'
    });
  });

  it('bloqueia funcionario desligado', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      employee_status: 'terminated'
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inactive_employee'
    });
  });

  it('bloqueia empresa inativa', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      company_status: 'inactive'
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inactive_company'
    });
  });

  it('bloqueia funcionario sem status empresarial', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      company_status: null
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inactive_company'
    });
  });

  it('prioriza arquivamento sobre outras restricoes', () => {
    const result = classifyEmployeeCpfBackfill({
      ...validEmployee,
      deleted_at: 1760000000000,
      company_id: null,
      cpf_encrypted: null
    });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'archived_employee'
    });
  });

  it('nao altera o registro original', () => {
    const employee = {
      ...validEmployee
    };

    const original = { ...employee };

    classifyEmployeeCpfBackfill(employee);

    expect(employee).toEqual(original);
  });

  it('nao devolve o CPF criptografado', () => {
    const result = classifyEmployeeCpfBackfill(
      validEmployee
    );

    expect(
      JSON.stringify(result)
    ).not.toContain(
      validEmployee.cpf_encrypted
    );
  });
});
