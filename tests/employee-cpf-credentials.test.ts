
import { describe, expect, it } from 'vitest';

import {
  resolveEmployeeCpfCredentials,
  type EmployeeCpfCandidate
} from '../server/core/employee-cpf-credentials';

import type {
  EmployeeCompanyLink
} from '../server/core/employee-company-selection';

// CR JORNADA - Passo 57.9.8
// Testes sem CPF real, D1 ou rede.
// Verificador ficticio usado somente nos testes.

function link(
  employeeId: string,
  companyId: string
): EmployeeCompanyLink {
  return {
    employee_id: employeeId,
    company_id: companyId,
    company_name: companyId,
    company_status: 'active',
    employee_status: 'active',
    deleted_at: null,
    account_active: true
  };
}

const candidates: EmployeeCpfCandidate[] = [
  {
    user_id: 'user-a',
    password_hash: 'hash-a',
    link: link('employee-a', 'company-a')
  },
  {
    user_id: 'user-b',
    password_hash: 'hash-b',
    link: link('employee-b', 'company-b')
  }
];

// Simula credenciais distintas para duas
// contas associadas ao mesmo CPF.
async function verify(
  password: string,
  hash: string
): Promise<boolean> {
  return (
    (password === 'senha-empresa-a' && hash === 'hash-a') ||
    (password === 'senha-empresa-b' && hash === 'hash-b')
  );
}

describe('CR JORNADA - verificacao de CPF multiempresa', () => {
  it('nega acesso com senha incorreta', async () => {
    const result = await resolveEmployeeCpfCredentials(
      'senha-incorreta',
      candidates,
      verify
    );

    expect(result.mode).toBe('denied');
  });

  it('libera apenas a empresa cuja senha foi validada', async () => {
    const result = await resolveEmployeeCpfCredentials(
      'senha-empresa-a',
      candidates,
      verify
    );

    expect(result.mode).toBe('automatic');

    if (result.mode === 'automatic') {
      expect(result.link.company_id).toBe('company-a');
      expect(result.link.employee_id).toBe('employee-a');
    }
  });

  it('nao libera outra empresa com senha diferente', async () => {
    const result = await resolveEmployeeCpfCredentials(
      'senha-empresa-b',
      candidates,
      verify
    );

    expect(result.mode).toBe('automatic');

    if (result.mode === 'automatic') {
      expect(result.link.company_id).toBe('company-b');
    }
  });

  it('permite selecionar empresas quando ambas validam', async () => {
    const samePasswordVerifier = async (
      password: string,
      hash: string
    ): Promise<boolean> => {
      return (
        password === 'senha-compartilhada' &&
        ['hash-a', 'hash-b'].includes(hash)
      );
    };

    const result = await resolveEmployeeCpfCredentials(
      'senha-compartilhada',
      candidates,
      samePasswordVerifier
    );

    expect(result.mode).toBe('selection_required');

    if (result.mode === 'selection_required') {
      expect(result.links).toHaveLength(2);
    }
  });

  it('bloqueia contas desativadas', async () => {
    const result = await resolveEmployeeCpfCredentials(
      'senha-empresa-a',
      [{
        ...candidates[0],
        link: {
          ...candidates[0].link,
          account_active: false
        }
      }],
      verify
    );

    expect(result.mode).toBe('denied');
  });

  it('bloqueia senhas vazias', async () => {
    const result = await resolveEmployeeCpfCredentials(
      '',
      candidates,
      verify
    );

    expect(result.mode).toBe('denied');
  });

  it('bloqueia contas duplicadas', async () => {
    await expect(
      resolveEmployeeCpfCredentials(
        'senha-empresa-a',
        [candidates[0], candidates[0]],
        verify
      )
    ).rejects.toThrow('invalid_employee_auth_candidates');
  });
});
