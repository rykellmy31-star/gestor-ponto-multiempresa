import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Ctx } from '../types';
import { ensure } from '../core/errors';
import { date } from '../core/validation';
import { verifyPassword } from '../core/crypto';
import { ipHash, limit } from '../core/security';
import { atomicIdentityWrite } from '../core/atomic-identity-write';
import { VALID_COMPANY_ADMIN_WRITE_SQL, companyAdminWriteParams } from '../core/company-admin-write-guard';

export async function updateCompanyEmployeeStatus(c:Ctx) {
  ensure(c.env.ENABLE_COMPANY_EMPLOYEE_REGISTRATION==='true',503,'employee_status_unavailable','A gestão de vínculos está em homologação.');
  const company=c.get('company')!,adminId=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
  ensure(new URL(c.req.url).search==='',400,'invalid_status','Não informe parâmetros de consulta.');
  const parsed=z.object({status:z.enum(['active','blocked','terminated']),
    expected_updated_at:z.number().int().nonnegative(),reason:z.string().trim().min(10).max(500),
    current_password:z.string().min(1).max(128),employment_end:date.optional()}).strict()
    .safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_status','Confira a situação, o motivo e sua senha.');
  const input=parsed.data,db=c.get('db'),employeeId=c.req.param('id');
  await limit(c,'employee-status:'+company.id+':'+adminId,15,3600000);
  const target=await db.prepare(`SELECT e.status,e.updated_at,e.admission_date,e.employment_end,
    u.id AS user_id,u.auth_version,co.timezone FROM employees e
    JOIN users u ON u.employee_id=e.id AND u.role='employee'
    JOIN employee_cpf_links l ON l.employee_id=e.id AND l.company_id=e.company_id
    JOIN companies co ON co.id=e.company_id AND co.status='active'
    WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL`)
    .bind(employeeId,company.id).first<{status:string;updated_at:number;admission_date:string;
      employment_end:string|null;user_id:string;auth_version:number;timezone:string}>();
  ensure(target,404,'employee_not_found','Vínculo por CPF não encontrado nesta empresa.');
  ensure(target.updated_at===input.expected_updated_at,409,'employee_status_conflict','Atualize a lista: o vínculo foi alterado.');
  ensure(target.status!=='terminated'&&target.status!==input.status&&target.employment_end===null,
    409,'invalid_status_transition','Esta mudança não é permitida. Um desligamento não pode ser reaberto por este fluxo.');
  const terminating=input.status==='terminated';
  const today=DateTime.fromMillis(Date.now(),{zone:target.timezone}).toISODate();
  ensure(terminating?Boolean(input.employment_end&&today&&input.employment_end>=target.admission_date&&input.employment_end<=today):input.employment_end===undefined,
    400,'invalid_employment_end','Informe um desligamento entre a admissão e a data atual da empresa.');
  const manager=await db.prepare('SELECT password_hash FROM company_admins WHERE id=? AND company_id=? AND active=1 AND must_change_password=0')
    .bind(adminId,company.id).first<{password_hash:string}>();
  ensure(manager&&await verifyPassword(input.current_password,manager.password_hash,c.env.AUTH_PEPPER),
    403,'invalid_password','Não foi possível confirmar sua identidade.');
  if(terminating){
    const incompatible=await db.prepare(`SELECT id FROM work_days WHERE employee_id=?
      AND (company_id IS NOT ? OR (next_seq>0 AND (next_seq<4 OR work_date>?))) LIMIT 1`)
      .bind(employeeId,company.id,input.employment_end!).first();
    ensure(!incompatible,409,'employment_history_conflict','Conclua os dias abertos e confira a data e a empresa dos pontos antes do desligamento.');
  }
  const now=Date.now(),updatedAt=Math.max(now,target.updated_at+1);
  // Também verifica dias abertos e datas no UPDATE, impedindo corrida com uma batida.
  const end=input.employment_end??null;
  await atomicIdentityWrite(db,[
    db.prepare(`UPDATE employees SET status=?,employment_end=?,updated_at=?
      WHERE id=? AND company_id=? AND deleted_at IS NULL AND updated_at=? AND status=?
      AND EXISTS(SELECT 1 FROM companies co WHERE co.id=employees.company_id AND co.status='active' AND co.timezone=?)
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.employee_id=employees.id AND u.role='employee' AND u.auth_version=?)
      AND (?=0 OR NOT EXISTS(SELECT 1 FROM work_days d WHERE d.employee_id=employees.id
        AND (d.company_id IS NOT ? OR (d.next_seq>0 AND (d.next_seq<4 OR d.work_date>?)))))
      AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
      AND EXISTS(SELECT 1 FROM company_admins ca WHERE ca.id=? AND ca.company_id=? AND ca.password_hash=?)`)
      .bind(input.status,end,updatedAt,employeeId,company.id,target.updated_at,target.status,target.timezone,
        target.user_id,target.auth_version,terminating?1:0,company.id,end,
        ...companyAdminWriteParams(token,adminId,company.id,now),adminId,company.id,manager.password_hash),
    db.prepare("UPDATE users SET active=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND employee_id=? AND role='employee'")
      .bind(input.status==='active'?1:0,updatedAt,target.user_id,employeeId),
    db.prepare('DELETE FROM employee_company_sessions WHERE user_id=? AND employee_id=? AND company_id=?')
      .bind(target.user_id,employeeId,company.id),
    db.prepare(`INSERT INTO audit_log(id,actor_id,action,entity_type,entity_id,details_json,ip_hash,created_at)
      VALUES(?,NULL,'company.employee.status_changed','employee',?,?,?,?)`)
      .bind(crypto.randomUUID(),employeeId,JSON.stringify({company_id:company.id,admin_id:adminId,
        reason:input.reason,before:{status:target.status,employment_end:target.employment_end},
        after:{status:input.status,employment_end:end}}),ipHash(c),now)
  ],'employee_status_conflict');
  return c.json({success:true,company_id:company.id,employee_id:employeeId,
    status:input.status,employment_end:end,updated_at:updatedAt});
}
