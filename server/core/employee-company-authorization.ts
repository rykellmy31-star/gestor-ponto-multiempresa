
import {
  resolveEmployeeCompanies,
  type EmployeeCompanyLink
} from './employee-company-selection';

// CR JORNADA - Passo 57.9.7
// Validacao da empresa escolhida apos autenticacao.
//
// Os vinculos devem ser carregados pelo servidor,
// somente depois da verificacao do CPF e senha.
//
// Nao consulta D1, nao cria sessao e nao libera rotas.

export function authorizeEmployeeCompany(
  authenticated: boolean,
  links: EmployeeCompanyLink[],
  requestedCompanyId: string
): EmployeeCompanyLink {
  if (!authenticated) {
    throw new Error('employee_not_authenticated');
  }

  if (
    typeof requestedCompanyId !== 'string' ||
    requestedCompanyId.trim() === ''
  ) {
    throw new Error('invalid_company_selection');
  }

  const result = resolveEmployeeCompanies(links);

  if (result.mode === 'denied') {
    throw new Error('employee_access_denied');
  }

  const allowed =
    result.mode === 'automatic'
      ? [result.link]
      : result.links;

  const selected = allowed.find(
    (link) => link.company_id === requestedCompanyId
  );

  if (!selected) {
    throw new Error('company_access_denied');
  }

  return selected;
}
