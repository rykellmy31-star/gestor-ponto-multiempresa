
import {
  resolveEmployeeCompanies,
  type EmployeeCompanyLink,
  type EmployeeCompanySelection
} from './employee-company-selection';

// CR JORNADA - Passo 57.9.8
//
// Verifica as senhas das contas encontradas
// para um CPF antes de permitir escolher empresa.
//
// Nao consulta D1 nem cria sessoes.
// Nao modifica a autenticacao administrativa.
// Recebe candidatos carregados pelo servidor
// mediante consulta segura de CPF.

export type EmployeeCpfCandidate = {
  user_id: string;
  password_hash: string;
  link: EmployeeCompanyLink;
};

export type EmployeePasswordVerifier = (
  password: string,
  passwordHash: string
) => Promise<boolean>;

export async function resolveEmployeeCpfCredentials(
  password: string,
  candidates: EmployeeCpfCandidate[],
  verify: EmployeePasswordVerifier
): Promise<EmployeeCompanySelection> {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > 128
  ) {
    return {
      mode: 'denied',
      links: []
    };
  }

  const authorized: EmployeeCompanyLink[] = [];

  const seenUsers = new Set<string>();

  for (const candidate of candidates) {
    if (
      !candidate.user_id ||
      !candidate.password_hash ||
      seenUsers.has(candidate.user_id)
    ) {
      throw new Error('invalid_employee_auth_candidates');
    }

    seenUsers.add(candidate.user_id);

    // A verificacao precisa usar o mecanismo
    // de senha do servidor, nunca comparacao
    // direta entre senha e hash.
    const valid = await verify(
      password,
      candidate.password_hash
    );

    if (!valid) {
      continue;
    }

    if (!candidate.link.account_active) {
      continue;
    }

    authorized.push(candidate.link);
  }

  return resolveEmployeeCompanies(authorized);
}
