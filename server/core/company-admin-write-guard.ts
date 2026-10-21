/**
 * Revalidate the tenant admin session inside each schedule write.
 * Suspension, session revocation or password reset between middleware and
 * D1.batch() must prevent the attempted INSERT from committing.
 *
 * Params: token hash, admin id, company id, now, now minus 30 minutes.
 */
export const VALID_COMPANY_ADMIN_WRITE_SQL = [
  'EXISTS (SELECT 1 FROM company_admin_sessions cas',
  'JOIN company_admins ca ON ca.id=cas.admin_id',
  'AND ca.company_id=cas.company_id',
  'WHERE cas.token_hash=? AND cas.admin_id=? AND cas.company_id=?',
  'AND cas.auth_version=ca.auth_version',
  'AND ca.active=1 AND ca.must_change_password=0',
  'AND cas.expires_at>? AND cas.last_seen_at>?)'
].join(' ');

export function companyAdminWriteParams(
  tokenHash: string, adminId: string, companyId: string, now: number
): [string, string, string, number, number] {
  return [tokenHash, adminId, companyId, now, now - 30 * 60000];
}
