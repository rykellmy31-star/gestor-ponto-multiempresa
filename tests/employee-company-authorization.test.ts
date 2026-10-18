
import { describe, expect, it } from 'vitest';

import {
  authorizeEmployeeCompany
} from '../server/core/employee-company-authorization';

import type {
  EmployeeCompanyLink
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

describe('CR JORNADA - autorizacao empresarial', () => {
  it('permite escolher empresa autorizada', () => {
    const result = authorizeEmployeeCompany(
      true,
      [companyA, companyB],
      'company-b'
    );

    expect(result.employee_id).toBe('employee-b');
    expect(result.company_id).toBe('company-b');
  });

  it('bloqueia empresa sem vinculo', () => {
    expect(() =>
      authorizeEmployeeCompany(
        true,
        [companyA],
        'company-b'
      )
    ).toThrow('company_access_denied');
  });

  it('bloqueia acesso sem autenticacao', () => {
    expect(() =>
      authorizeEmployeeCompany(
        false,
        [companyA],
        'company-a'
      )
    ).toThrow('employee_not_authenticated');
  });

  it('bloqueia empresa desativada', () => {
    expect(() =>
      authorizeEmployeeCompany(
        true,
        [{
          ...companyA,
          company_status: 'inactive'
        }],
        'company-a'
      )
    ).toThrow('employee_access_denied');
  });

  it('bloqueia funcionario arquivado', () => {
    expect(() =>
      authorizeEmployeeCompany(
        true,
        [{
          ...companyA,
          deleted_at: 1760000000000
        }],
        'company-a'
      )
    ).toThrow('employee_access_denied');
  });

  it('bloqueia selecao vazia', () => {
    expect(() =>
      authorizeEmployeeCompany(
        true,
        [companyA],
        ''
      )
    ).toThrow('invalid_company_selection');
  });

  it('rejeita vinculos duplicados na empresa', () => {
    expect(() =>
      authorizeEmployeeCompany(
        true,
        [
          companyA,
          {
            ...companyA,
            employee_id: 'employee-duplicated'
          }
        ],
        'company-a'
      )
    ).toThrow('duplicate_employee_company_link');
  });

  it('nao permite acessar empresa com conta desativada', () => {
    expect(() =>
      authorizeEmployeeCompany(
        true,
        [companyA, {
          ...companyB,
          account_active: false
        }],
        'company-b'
      )
    ).toThrow('company_access_denied');
  });
});
