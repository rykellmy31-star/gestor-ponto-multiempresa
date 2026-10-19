import {
  validateEmployeeCpfBackfill
} from './employee-cpf-backfill-validation';
import type {
  EmployeeCpfBackfillRecord
} from './employee-cpf-backfill';
import { analyzeEmployeeCpfBackfill } from './employee-cpf-backfill-conflicts';
import { prepareEmployeeCpfImportBatch } from './employee-cpf-backfill-batch';
import { decryptEmployeeCpf } from './employee-cpf-decrypt';
import { importEmployeeCpfBatch } from './employee-cpf-import';

// Servico interno, sem rota publica.
// O chamador deve ser um administrador autorizado, fora deste modulo.
// Le apenas os funcionarios solicitados e usa D1.batch para gravacao atomica.
// Segredos sao fornecidos pelo servidor, jamais pelos parametros HTTP.

type EmployeeCpfSourceRow = EmployeeCpfBackfillRecord;

function validateEmployeeIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new Error('cpf_backfill_invalid_selection');
  }

  const seen = new Set<string>();

  for (const id of ids) {
    if (typeof id !== 'string' || id.length > 128 || !id.trim() || seen.has(id)) {
      throw new Error('cpf_backfill_invalid_selection');
    }
    seen.add(id);
  }

  return [...ids];
}

export async function backfillEmployeeCpfLinks(
  db: D1DatabaseSession,
  employeeIds: string[],
  dataKeyHex: string,
  cpfLookupSecret: string
): Promise<{ inserted: number }> {
  const ids = validateEmployeeIds(employeeIds);

  if (!/^[a-f0-9]{64}$/.test(dataKeyHex || '') ||
      !cpfLookupSecret || cpfLookupSecret.length < 32) {
    throw new Error('cpf_backfill_configuration_required');
  }

  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    'SELECT e.id,e.company_id,e.cpf_encrypted,e.deleted_at,' +
    ' e.status AS employee_status,c.status AS company_status' +
    ' FROM employees e LEFT JOIN companies c ON c.id=e.company_id' +
    ' WHERE e.id IN (' + placeholders + ')'
  ).bind(...ids).all<EmployeeCpfSourceRow>();

  // Nenhum id pode ser omitido; nao importa lote parcial.
  if (!result.results || result.results.length !== ids.length) {
    throw new Error('cpf_backfill_selection_changed');
  }

  const validations = [];
  for (const employee of result.results) {
    validations.push(await validateEmployeeCpfBackfill(
      employee,
      cpfLookupSecret,
      (ciphertext) => decryptEmployeeCpf(ciphertext, dataKeyHex)
    ));
  }

  const analysis = analyzeEmployeeCpfBackfill(validations);
  const prepared = prepareEmployeeCpfImportBatch(analysis);

  // Conflitos preexistentes, alteracoes concorrentes e links de outra
  // empresa sao bloqueados pelas constraints e verificacoes do INSERT.
  return importEmployeeCpfBatch(db, prepared);
}
