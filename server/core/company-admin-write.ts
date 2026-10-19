import { ApiError } from './errors';

// A verificação ocorre dentro do mesmo batch: lançar depois do commit não desfaz
// revogações ou auditorias. changes() refere-se ao UPDATE imediatamente anterior.
export async function companyAdminWrite(
  db: D1DatabaseSession,
  statements: D1PreparedStatement[],
  code: string
) {
  const id = crypto.randomUUID();
  try {
    const [update, ...remaining] = statements;
    return await db.batch([
      update,
      db.prepare('INSERT INTO company_admin_write_guards(id,affected_rows) VALUES (?,changes())').bind(id),
      db.prepare('DELETE FROM company_admin_write_guards WHERE id=?').bind(id),
      ...remaining
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('company_admin_write_conflict')) {
      throw new ApiError(409, code,
        'O administrador foi alterado em outra sessão. Entre novamente e tente outra vez.');
    }
    throw error;
  }
}
