import { ApiError } from './errors';

// A guarda da migração 0026 é compartilhada pelas alterações de credenciais.
// changes() deve ser avaliado imediatamente após a atualização otimista.
export async function atomicIdentityWrite(
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
        'A conta foi alterada em outra sessão. Entre novamente e tente outra vez.');
    }
    throw error;
  }
}
