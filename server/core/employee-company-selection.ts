
/**
 * CR JORNADA - Passo 57.9.6
 *
 * Seleciona vinculos empresariais autorizados.
 *
 * Esta funcao deve receber somente vinculos
 * obtidos e verificados pelo servidor.
 *
 * Nao autentica CPF ou senha.
 * Nao cria sessoes.
 * Nao consulta nem altera o banco D1.
 */

export type EmployeeCompanyLink = {
  employee_id: string;
  company_id: string;
  company_name: string;
  company_status: string;
  employee_status: string;
  deleted_at: number | null;
  account_active: boolean;
};

export type EmployeeCompanySelection =
  | {
      mode: 'denied';
      links: [];
    }
  | {
      mode: 'automatic';
      link: EmployeeCompanyLink;
    }
  | {
      mode: 'selection_required';
      links: EmployeeCompanyLink[];
    };

export function resolveEmployeeCompanies(
  links: EmployeeCompanyLink[]
): EmployeeCompanySelection {
  const eligible = links.filter((link) =>
    Boolean(link.employee_id) &&
    Boolean(link.company_id) &&
    link.company_status === 'active' &&
    link.employee_status === 'active' &&
    link.deleted_at === null &&
    link.account_active === true
  );

  // Evita vinculos repetidos na mesma empresa.
  const unique = new Map<
    string,
    EmployeeCompanyLink
  >();

  for (const link of eligible) {
    if (unique.has(link.company_id)) {
      throw new Error(
        'duplicate_employee_company_link'
      );
    }

    unique.set(link.company_id, link);
  }

  const valid = [...unique.values()];

  if (valid.length === 0) {
    return {
      mode: 'denied',
      links: []
    };
  }

  if (valid.length === 1) {
    return {
      mode: 'automatic',
      link: valid[0]
    };
  }

  return {
    mode: 'selection_required',
    links: valid.sort((a, b) =>
      a.company_name.localeCompare(
        b.company_name,
        'pt-BR'
      )
    )
  };
}
