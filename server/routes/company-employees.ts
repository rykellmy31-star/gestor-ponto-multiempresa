import { z } from 'zod';
import { ensure } from '../core/errors';
import { hashPassword, randomToken, verifyPassword } from '../core/crypto';
import { ipHash, limit } from '../core/security';
import { atomicIdentityWrite } from '../core/atomic-identity-write';

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
    employees: result.results ?? [],
    recovery_available: c.env.ENABLE_EMPLOYEE_PASSWORD_RECOVERY === 'true'
  });
});

// Recuperação assistida sem e-mail ou reutilização de acesso legado.
companyEmployeesRoutes.post('/:id/reset-password', async c => {
  ensure(c.env.ENABLE_EMPLOYEE_PASSWORD_RECOVERY === 'true', 503,
    'employee_recovery_unavailable', 'A recuperação de funcionários está em homologação.');
  const company=c.get('company'), adminId=c.get('companyAdminId');
  const adminToken=c.get('companyAdminTokenHash');
  ensure(company && adminId && adminToken,401,'unauthenticated','Entre novamente.');
  await limit(c,'employee-reset:'+company.id+':'+adminId,8,3600000);
  await limit(c,'employee-reset-ip:'+ipHash(c),20,3600000);
  const parsed=z.object({current_password:z.string().min(1).max(128)}).strict()
    .safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_recovery','Confirme a senha do administrador.');
  const db=c.get('db');
  const manager=await db.prepare(
    'SELECT password_hash FROM company_admins WHERE id=? AND company_id=? AND active=1 AND must_change_password=0'
  ).bind(adminId,company.id).first<{password_hash:string}>();
  ensure(manager && await verifyPassword(parsed.data.current_password,
    manager.password_hash,c.env.AUTH_PEPPER),401,'invalid_password',
    'Senha do administrador incorreta.');
  const employeeId=c.req.param('id');
  const target=await db.prepare(`
    SELECT u.id,u.auth_version FROM employees e
    JOIN users u ON u.employee_id=e.id AND u.role='employee' AND u.active=1
    JOIN employee_cpf_links l ON l.employee_id=e.id AND l.company_id=e.company_id
    JOIN companies co ON co.id=e.company_id AND co.status='active'
    WHERE e.id=? AND e.company_id=? AND e.status='active' AND e.deleted_at IS NULL
  `).bind(employeeId,company.id).first<{id:string;auth_version:number}>();
  ensure(target,404,'employee_access_not_found',
    'Funcionário ativo com acesso por CPF não encontrado nesta empresa.');
  const temporaryPassword=randomToken().slice(0,24);
  const hashed=await hashPassword(temporaryPassword,c.env.AUTH_PEPPER);
  const now=Date.now(), expiresAt=now+24*3600000;
  await atomicIdentityWrite(db,[
    db.prepare(`
      UPDATE users SET password_hash=?,must_change_password=1,
        employee_temporary_password_expires_at=?,updated_at=?
      WHERE id=? AND employee_id=? AND role='employee' AND active=1 AND auth_version=?
        AND EXISTS (
          SELECT 1 FROM employees e JOIN companies co ON co.id=e.company_id
          JOIN employee_cpf_links l ON l.employee_id=e.id AND l.company_id=e.company_id
          WHERE e.id=users.employee_id AND e.company_id=? AND co.status='active'
            AND e.status='active' AND e.deleted_at IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM company_admin_sessions s
          JOIN company_admins a ON a.id=s.admin_id AND a.company_id=s.company_id
          WHERE s.token_hash=? AND s.company_id=? AND a.id=?
            AND s.auth_version=a.auth_version AND a.active=1 AND a.must_change_password=0
            AND a.password_hash=? AND s.expires_at>? AND s.last_seen_at>?
        )
    `).bind(hashed,expiresAt,now,target.id,employeeId,target.auth_version,company.id,
      adminToken,company.id,adminId,manager.password_hash,now,now-1800000),
    db.prepare('DELETE FROM employee_company_sessions WHERE user_id=? AND employee_id=? AND company_id=?')
      .bind(target.id,employeeId,company.id),
    db.prepare(`INSERT INTO company_employee_security_events
      (id,company_id,employee_id,user_id,admin_id,action,created_at)
      VALUES (?,?,?,?,?,'password_reset',?)`)
      .bind(crypto.randomUUID(),company.id,employeeId,target.id,adminId,now)
  ],'employee_recovery_conflict');
  c.header('Cache-Control','private, no-store');
  c.header('Pragma','no-cache');
  return c.json({success:true,company_id:company.id,employee_id:employeeId,
    temporary_password:temporaryPassword,expires_at:expiresAt,must_change_password:true});
});
