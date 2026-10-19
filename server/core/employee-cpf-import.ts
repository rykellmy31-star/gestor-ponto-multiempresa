import type {
  EmployeeCpfImportBatch,
  EmployeeCpfImportItem
} from './employee-cpf-backfill-batch';

// CR JORNADA — importacao interna de CPFs ja validados.
// Nunca expor esta funcao diretamente como endpoint publico.
// D1DatabaseSession.batch: todas as instrucoes sao atomicas.
const MAX_IMPORT_ITEMS = 50;

export const INSERT_EMPLOYEE_CPF_LINK_SQL = `
  INSERT INTO employee_cpf_links (
    employee_id, company_id, cpf_lookup_key,
    created_at, updated_at
  ) VALUES (
    ?,
    CASE WHEN EXISTS (
      SELECT 1
      FROM employees e
      JOIN companies c ON c.id = e.company_id
      WHERE e.id = ?
        AND e.company_id = ?
        AND e.status = 'active'
        AND e.deleted_at IS NULL
        AND e.cpf_encrypted IS NOT NULL
        AND length(trim(e.cpf_encrypted)) > 0
        AND c.status = 'active'
    ) THEN ? ELSE NULL END,
    ?, ?, ?
  )
`;

function validateBatch(batch: EmployeeCpfImportBatch): EmployeeCpfImportItem[] {
  if (
    !batch ||
    batch.status !== 'prepared' ||
    !Array.isArray(batch.items) ||
    !Number.isSafeInteger(batch.total) ||
    batch.total !== batch.items.length ||
    batch.total < 1 ||
    batch.total > MAX_IMPORT_ITEMS
  ) {
    throw new Error('cpf_import_invalid_batch');
  }

  const employees = new Set<string>();
  const companyKeys = new Set<string>();
  const items: EmployeeCpfImportItem[] = [];

  for (const item of batch.items) {
    if (
      !item ||
      typeof item.employee_id !== 'string' ||
      typeof item.company_id !== 'string' ||
      typeof item.cpf_lookup_key !== 'string' ||
      !item.employee_id.trim() ||
      !item.company_id.trim() ||
      !/^[a-f0-9]{64}$/.test(item.cpf_lookup_key)
    ) {
      throw new Error('cpf_import_invalid_item');
    }

    const companyCpf = JSON.stringify([item.company_id, item.cpf_lookup_key]);
    if (employees.has(item.employee_id) || companyKeys.has(companyCpf)) {
      throw new Error('cpf_import_duplicate_item');
    }

    employees.add(item.employee_id);
    companyKeys.add(companyCpf);
    items.push({ ...item });
  }

  return items;
}

export async function importEmployeeCpfBatch(
  db: D1DatabaseSession,
  batch: EmployeeCpfImportBatch,
  now: number = Date.now()
): Promise<{ inserted: number }> {
  const items = validateBatch(batch);

  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error('cpf_import_invalid_timestamp');
  }

  // O estado do funcionario e empresa e conferido pelo proprio INSERT.
  // A ausencia de vinculo valido causa NOT NULL constraint failed,
  // abortando o batch inteiro, inclusive inserts anteriores.
  // UNIQUE / FOREIGN KEY tambem provocam rollback integral.
  const statements = items.map(item =>
    db.prepare(INSERT_EMPLOYEE_CPF_LINK_SQL).bind(
      item.employee_id,
      item.employee_id,
      item.company_id,
      item.company_id,
      item.cpf_lookup_key,
      now,
      now
    )
  );

  // Nao usar OR IGNORE, REPLACE ou retry parcial.
  await db.batch(statements);
  return { inserted: items.length };
}
