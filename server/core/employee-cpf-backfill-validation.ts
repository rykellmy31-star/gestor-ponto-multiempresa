
import {
  classifyEmployeeCpfBackfill,
  type EmployeeCpfBackfillRecord
} from './employee-cpf-backfill';

import {
  normalizeEmployeeCpf,
  employeeCpfLookupKey
} from './employee-cpf';

// CR JORNADA - Passo 57.9.17
//
// Prepara a identificacao segura de CPFs legados.
//
// NAO acessa o banco.
// NAO grava vinculos.
// NAO cria usuarios ou sessoes.
// NAO faz deploy ou migracao.
//
// A descriptografia deve ser fornecida pelo
// servidor, com autorizacao e segredo correto.

export type EmployeeCpfDecryptor = (
  encrypted: string
) => Promise<string>;

export type EmployeeCpfValidatedLink = {
  status: 'validated';
  employee_id: string;
  company_id: string;
  cpf_lookup_key: string;
};

export type EmployeeCpfRejectedLink = {
  status: 'rejected';
  employee_id: string;
  reason:
    | 'missing_company'
    | 'missing_cpf'
    | 'archived_employee'
    | 'inactive_employee'
    | 'inactive_company'
    | 'invalid_cpf'
    | 'decryption_failed';
};

export type EmployeeCpfValidationResult =
  | EmployeeCpfValidatedLink
  | EmployeeCpfRejectedLink;

export async function validateEmployeeCpfBackfill(
  employee: EmployeeCpfBackfillRecord,
  secret: string,
  decrypt: EmployeeCpfDecryptor
): Promise<EmployeeCpfValidationResult> {
  // Falha de configuracao deve interromper
  // o processamento, sem gerar identificadores.
  if (
    typeof secret !== 'string' ||
    secret.length < 32
  ) {
    throw new Error('invalid_cpf_lookup_secret');
  }

  const classification =
    classifyEmployeeCpfBackfill(employee);

  if (classification.status === 'blocked') {
    return {
      status: 'rejected',
      employee_id: classification.employee_id,
      reason: classification.reason
    };
  }

  let cpf: string;

  try {
    cpf = await decrypt(employee.cpf_encrypted!);
  } catch {
    // Nunca retornar detalhes de descriptografia
    // nem o CPF em mensagens de erro.
    return {
      status: 'rejected',
      employee_id: employee.id,
      reason: 'decryption_failed'
    };
  }

  let normalizedCpf: string;

  try {
    normalizedCpf = normalizeEmployeeCpf(cpf);
  } catch {
    return {
      status: 'rejected',
      employee_id: employee.id,
      reason: 'invalid_cpf'
    };
  }

  const cpfLookupKey = employeeCpfLookupKey(
    normalizedCpf,
    secret
  );

  return {
    status: 'validated',
    employee_id: employee.id,
    company_id: classification.company_id,
    cpf_lookup_key: cpfLookupKey
  };
}
