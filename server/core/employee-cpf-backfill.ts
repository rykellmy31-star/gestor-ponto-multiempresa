
export type EmployeeCpfBackfillRecord = {
  id: string;
  company_id: string | null;
  cpf_encrypted: string | null;
  deleted_at: number | null;
  employee_status: string;
  company_status: string | null;
};

export type EmployeeCpfBackfillDecision =
  | {
      status: 'eligible_for_review';
      employee_id: string;
      company_id: string;
    }
  | {
      status: 'blocked';
      employee_id: string;
      reason:
        | 'missing_company'
        | 'missing_cpf'
        | 'archived_employee'
        | 'inactive_employee'
        | 'inactive_company';
    };

export function classifyEmployeeCpfBackfill(
  employee: EmployeeCpfBackfillRecord
): EmployeeCpfBackfillDecision {
  if (employee.deleted_at !== null) {
    return {
      status: 'blocked',
      employee_id: employee.id,
      reason: 'archived_employee'
    };
  }

  if (
    !employee.company_id ||
    employee.company_id.trim() === ''
  ) {
    return {
      status: 'blocked',
      employee_id: employee.id,
      reason: 'missing_company'
    };
  }

  if (
    !employee.cpf_encrypted ||
    employee.cpf_encrypted.trim() === ''
  ) {
    return {
      status: 'blocked',
      employee_id: employee.id,
      reason: 'missing_cpf'
    };
  }

  if (employee.employee_status !== 'active') {
    return {
      status: 'blocked',
      employee_id: employee.id,
      reason: 'inactive_employee'
    };
  }

  if (employee.company_status !== 'active') {
    return {
      status: 'blocked',
      employee_id: employee.id,
      reason: 'inactive_company'
    };
  }

  return {
    status: 'eligible_for_review',
    employee_id: employee.id,
    company_id: employee.company_id
  };
}
