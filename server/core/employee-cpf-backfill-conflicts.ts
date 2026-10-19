
import type {
  EmployeeCpfValidationResult
} from './employee-cpf-backfill-validation';

// CR JORNADA - Passo 57.9.19
//
// Detecta conflitos antes da importacao
// dos CPFs legados.
//
// Nao consulta nem modifica o D1.
// Nao descriptografa CPF.
// Nao cria usuarios ou sessoes.
// Nao registra informacoes sensiveis em logs.

export type CpfConflictReason =
  | 'duplicate_employee'
  | 'duplicate_company_cpf'
  | 'invalid_lookup_key';

export type CpfConflict = {
  employee_id: string;
  company_id: string | null;
  reason: CpfConflictReason;
};

export type CpfBackfillAnalysis = {
  ready: boolean;
  approved: Array<{
    employee_id: string;
    company_id: string;
    cpf_lookup_key: string;
  }>;
  rejected: Array<{
    employee_id: string;
    reason: string;
  }>;
  conflicts: CpfConflict[];
};

// Exige chave HMAC no formato hexadecimal esperado.
function isValidKey(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

// Separador para agrupamento interno.
// JSON evita ambiguidades com caracteres
// que possam existir em identificadores.
function groupKey(
  companyId: string,
  cpfKey: string
): string {
  return JSON.stringify([companyId, cpfKey]);
}

export function analyzeEmployeeCpfBackfill(
  records: EmployeeCpfValidationResult[]
): CpfBackfillAnalysis {
  const approved: CpfBackfillAnalysis['approved'] = [];
  const rejected: CpfBackfillAnalysis['rejected'] = [];
  const conflicts: CpfConflict[] = [];

  const valid = records.filter(
    (record) => record.status === 'validated'
  );

  // Identifica funcionarios repetidos na
  // entrada, inclusive com empresas diferentes.
  const employeeCounts = new Map<string, number>();

  for (const record of records) {
    const id = record.employee_id;

    employeeCounts.set(
      id,
      (employeeCounts.get(id) || 0) + 1
    );
  }

  // Identifica CPFs repetidos dentro
  // da mesma empresa.
  const cpfCounts = new Map<string, number>();

  for (const record of valid) {
    if (
      !record.employee_id.trim() ||
      !record.company_id.trim() ||
      !isValidKey(record.cpf_lookup_key)
    ) {
      continue;
    }

    const key = groupKey(
      record.company_id,
      record.cpf_lookup_key
    );

    cpfCounts.set(
      key,
      (cpfCounts.get(key) || 0) + 1
    );
  }

  for (const record of records) {
    if (record.status === 'rejected') {
      rejected.push({
        employee_id: record.employee_id,
        reason: record.reason
      });
    }

    // Nao autoriza nenhum registro que
    // apareca mais de uma vez na entrada.
    if (
      (employeeCounts.get(record.employee_id) || 0) > 1
    ) {
      conflicts.push({
        employee_id: record.employee_id,
        company_id:
          record.status === 'validated'
            ? record.company_id
            : null,
        reason: 'duplicate_employee'
      });

      continue;
    }

    if (record.status !== 'validated') {
      continue;
    }

    if (
      !record.employee_id.trim() ||
      !record.company_id.trim() ||
      !isValidKey(record.cpf_lookup_key)
    ) {
      conflicts.push({
        employee_id: record.employee_id,
        company_id: record.company_id,
        reason: 'invalid_lookup_key'
      });

      continue;
    }

    const key = groupKey(
      record.company_id,
      record.cpf_lookup_key
    );

    if ((cpfCounts.get(key) || 0) > 1) {
      conflicts.push({
        employee_id: record.employee_id,
        company_id: record.company_id,
        reason: 'duplicate_company_cpf'
      });

      continue;
    }

    approved.push({
      employee_id: record.employee_id,
      company_id: record.company_id,
      cpf_lookup_key: record.cpf_lookup_key
    });
  }

  // Aprovado significa apenas que passou
  // na verificacao deste lote.
  //
  // Antes de gravar, o servidor precisara
  // consultar o D1, verificar concorrencia,
  // duplicidades existentes e autorizacao.
  //
  // Qualquer conflito impede a liberacao
  // automatica do lote completo.
  return {
    ready:
      conflicts.length === 0 &&
      rejected.length === 0,
    approved,
    rejected,
    conflicts
  };
}
