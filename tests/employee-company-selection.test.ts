
import { describe, expect, it } from 'vitest';

import {
  resolveEmployeeCompanies,
  type EmployeeCompanyLink
} from '../server/core/employee-company-selection';

const companyA: EmployeeCompanyLink = {
  employee_id: 'employee-a',
  company_id: 'company-a',
  company_name: 'Empresa A',
  company_status: 'active',
  employee_status: 'active',
  deleted_at: null,
  account_active: true
};

const companyB: EmployeeCompanyLink = {
  employee_id: 'employee-b',
  company_id: 'company-b',
  company_name: 'Empresa B',
  company_status: 'active',
  employee_status: 'active',
  deleted_at: null,
  account_active: true
};

describe('CR JORNADA - selecao empresarial por CPF', () => {
  it('nega acesso sem vinculos', () => {
    expect(
      resolveEmployeeCompanies([])
    ).toEqual({
      mode: 'denied',
      links: []
    });
  });

  it('seleciona automaticamente uma empresa', () => {
    const result = resolveEmployeeCompanies([
      companyA
    ]);

    expect(result.mode).toBe('automatic');

    if (result.mode === 'automatic') {
      expect(result.link.company_id).toBe(
        'company-a'
      );
    }
  });

  it('solicita selecao quando existem dois vinculos', () => {
    const result = resolveEmployeeCompanies([
      companyB,
      companyA
    ]);

    expect(result.mode).toBe(
      'selection_required'
    );

    if (result.mode === 'selection_required') {
      expect(
        result.links.map(link => link.company_id)
      ).toEqual([
        'company-a',
        'company-b'
      ]);
    }
  });

  it('bloqueia funcionario arquivado', () => {
    const result = resolveEmployeeCompanies([
      {
        ...companyA,
        deleted_at: 1760000000000
      }
    ]);

    expect(result.mode).toBe('denied');
  });

  it('bloqueia empresa desativada', () => {
    const result = resolveEmployeeCompanies([
      {
        ...companyA,
        company_status: 'inactive'
      }
    ]);

    expect(result.mode).toBe('denied');
  });

  it('bloqueia conta desativada', () => {
    const result = resolveEmployeeCompanies([
      {
        ...companyA,
        account_active: false
      }
    ]);

    expect(result.mode).toBe('denied');
  });

  it('bloqueia funcionario inativo', () => {
    const result = resolveEmployeeCompanies([
      {
        ...companyA,
        employee_status: 'terminated'
      }
    ]);

    expect(result.mode).toBe('denied');
  });

  it('ignora vinculo invalido e permite o valido', () => {
    const result = resolveEmployeeCompanies([
      companyA,
      {
        ...companyB,
        account_active: false
      }
    ]);

    expect(result.mode).toBe('automatic');

    if (result.mode === 'automatic') {
      expect(result.link.employee_id).toBe(
        'employee-a'
      );
    }
  });

  it('rejeita dois vinculos ativos da mesma empresa', () => {
    expect(() =>
      resolveEmployeeCompanies([
        companyA,
        {
          ...companyA,
          employee_id: 'another-employee'
        }
      ])
    ).toThrow('duplicate_employee_company_link');
  });
});
