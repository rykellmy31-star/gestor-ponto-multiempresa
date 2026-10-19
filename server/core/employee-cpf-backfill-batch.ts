
import type {
  CpfBackfillAnalysis
} from './employee-cpf-backfill-conflicts';

// CR JORNADA - Passo 57.9.22
//
// Prepara um lote de CPF para importacao.
//
// Nao consulta ou modifica o D1.
// Nao descriptografa CPFs.
// Nao cria contas ou sessoes.
//
// A gravacao futura devera ocorrer
// em uma unica transacao no D1.

export type EmployeeCpfImportItem = {
  employee_id: string;
  company_id: string;
  cpf_lookup_key: string;
};

export type EmployeeCpfImportBatch = {
  status: 'prepared';
  items: EmployeeCpfImportItem[];
  total: number;
};

export function prepareEmployeeCpfImportBatch(
  analysis: CpfBackfillAnalysis
): EmployeeCpfImportBatch {
  if (
    analysis.ready !== true ||
    analysis.conflicts.length > 0 ||
    analysis.rejected.length > 0
  ) {
    throw new Error('cpf_backfill_batch_blocked');
  }

  if (analysis.approved.length === 0) {
    throw new Error('cpf_backfill_empty_batch');
  }

  const employeeIds = new Set<string>();
  const companyCpfs = new Set<string>();

  const items: EmployeeCpfImportItem[] = [];

  for (const item of analysis.approved) {
    if (
      !item.employee_id.trim() ||
      !item.company_id.trim() ||
      !/^[a-f0-9]{64}$/.test(item.cpf_lookup_key)
    ) {
      throw new Error('cpf_backfill_invalid_item');
    }

    const companyCpf = JSON.stringify([
      item.company_id,
      item.cpf_lookup_key
    ]);

    if (
      employeeIds.has(item.employee_id) ||
      companyCpfs.has(companyCpf)
    ) {
      throw new Error('cpf_backfill_duplicate_item');
    }

    employeeIds.add(item.employee_id);
    companyCpfs.add(companyCpf);

    items.push({
      employee_id: item.employee_id,
      company_id: item.company_id,
      cpf_lookup_key: item.cpf_lookup_key
    });
  }

  return {
    status: 'prepared',
    items,
    total: items.length
  };
}
