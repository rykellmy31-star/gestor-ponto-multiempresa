
import { Hono } from 'hono';
import type { App } from '../types';
import { requireCompanyAdmin } from './company-auth';

export const companyEmployeesRoutes = new Hono<App>();

// Todas as rotas deste modulo exigem
// uma sessao empresarial autenticada.
companyEmployeesRoutes.use('*', requireCompanyAdmin);

// Lista exclusivamente os funcionarios
// pertencentes a empresa autenticada.
companyEmployeesRoutes.get('/', async (c) => {
  const company = c.get('company');

  if (!company) {
    return c.json(
      {
        error: {
          code: 'unauthenticated',
          message: 'Sessao empresarial nao encontrada.'
        }
      },
      401
    );
  }

  const result = await c.get('db')
    .prepare(`
      SELECT
        id,
        full_name,
        registration,
        job_title,
        admission_date,
        employment_end,
        status,
        cpf_last4
      FROM employees
      WHERE company_id = ?
        AND deleted_at IS NULL
      ORDER BY full_name COLLATE NOCASE ASC
      LIMIT 200
    `)
    .bind(company.id)
    .all();

  return c.json({
    success: true,
    company_id: company.id,
    employees: result.results ?? []
  });
});
