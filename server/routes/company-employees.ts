import { z } from 'zod';
import { ensure } from '../core/errors';
import { encryptPersonal, hashPassword, randomToken, verifyPassword } from '../core/crypto';
import { ApiError } from '../core/errors';
import { date } from '../core/validation';
import { normalizeEmployeeCpf, employeeCpfLookupKey } from '../core/employee-cpf';
import { VALID_COMPANY_ADMIN_WRITE_SQL, companyAdminWriteParams } from '../core/company-admin-write-guard';
import { ipHash, limit } from '../core/security';
import { atomicIdentityWrite } from '../core/atomic-identity-write';
import { updateCompanyEmployeeStatus } from './company-employee-status';

import { Hono } from 'hono';
import type { App } from '../types';
import { requireCompanyAdmin } from './company-auth';

export const companyEmployeesRoutes = new Hono<App>();

// Todas as rotas deste modulo exigem
// uma sessao empresarial autenticada.
companyEmployeesRoutes.use('*', requireCompanyAdmin);
companyEmployeesRoutes.post('/:id/status', updateCompanyEmployeeStatus);

const registrationSchema=z.object({
  full_name:z.string().trim().min(3).max(140),
  registration:z.string().trim().min(1).max(40)
    .regex(/^[\p{L}\p{N}._-]+$/u),
  cpf:z.string().trim().min(11).max(14),
  job_title:z.string().trim().max(100),
  admission_date:date
}).strict();

// Feature-flagged until the full company onboarding is approved in staging.
// The public response never contains raw CPF, a hash or an encrypted secret.
companyEmployeesRoutes.post('/', async c=>{
  ensure(c.env.ENABLE_COMPANY_EMPLOYEE_REGISTRATION==='true',503,
    'employee_registration_unavailable','O cadastro está em homologação.');
  const company=c.get('company'),adminId=c.get('companyAdminId');
  const adminToken=c.get('companyAdminTokenHash');
  ensure(company&&adminId&&adminToken,401,'unauthenticated','Entre novamente.');
  await limit(c,'employee-register:'+company.id+':'+adminId,30,3600000);
  await limit(c,'employee-register-ip:'+ipHash(c),60,3600000);
  const parsed=registrationSchema.safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_employee','Confira os dados do funcionário.');
  const input=parsed.data;
  ensure(typeof c.env.CPF_LOOKUP_SECRET==='string'&&
    c.env.CPF_LOOKUP_SECRET.length>=32&&
    /^[0-9a-f]{64}$/i.test(c.env.DATA_KEY||'')&&
    typeof c.env.AUTH_PEPPER==='string'&&c.env.AUTH_PEPPER.length>=32,
    503,'employee_registration_unconfigured','Cadastro ainda não configurado.');
  let cpf:string,cpfKey:string;
  try {
    cpf=normalizeEmployeeCpf(input.cpf);
    cpfKey=employeeCpfLookupKey(cpf,c.env.CPF_LOOKUP_SECRET);
  }catch{
    throw new ApiError(400,'invalid_cpf','Informe um CPF válido.');
  }
  const db=c.get('db');
  const [duplicateRegistration,duplicateCpf]=await Promise.all([
    db.prepare([
      'SELECT id FROM employees WHERE company_id=? AND deleted_at IS NULL',
      'AND COALESCE(company_registration,registration)=? COLLATE NOCASE'
    ].join(' ')).bind(company.id,input.registration).first(),
    db.prepare('SELECT employee_id FROM employee_cpf_links WHERE company_id=? AND cpf_lookup_key=?')
      .bind(company.id,cpfKey).first()
  ]);
  ensure(!duplicateRegistration&&!duplicateCpf,409,'duplicate_employee',
    'CPF ou matrícula já está cadastrado nesta empresa.');
  const employeeId=crypto.randomUUID(),userId=crypto.randomUUID(),now=Date.now();
  const expiresAt=now+24*3600000;
  const temporaryPassword=randomToken().slice(0,24);
  const [passwordHash,cpfEncrypted]=await Promise.all([
    hashPassword(temporaryPassword,c.env.AUTH_PEPPER),
    encryptPersonal(cpf,c.env.DATA_KEY)
  ]);
  const guardId=crypto.randomUUID();
  const batch=[
    db.prepare([
      'INSERT INTO employees(',
      'id,full_name,registration,company_registration,cpf_encrypted,cpf_last4,',
      'job_title,admission_date,employment_end,status,notes,created_at,updated_at,company_id)',
      'SELECT ?,?,?,?,?,?,?,?,NULL,\'active\',\'\',?,?,co.id FROM companies co',
      'WHERE co.id=? AND co.status=\'active\'',
      'AND '+VALID_COMPANY_ADMIN_WRITE_SQL
    ].join(' ')).bind(
      employeeId,input.full_name,'emp-'+employeeId,input.registration,
      cpfEncrypted,cpf.slice(-4),input.job_title,input.admission_date,now,now,
      company.id,...companyAdminWriteParams(adminToken,adminId,company.id,now)
    ),
    db.prepare('INSERT INTO company_employee_write_guards(id,affected_rows) VALUES (?,changes())')
      .bind(guardId),
    // The CHECK-as-guard above aborts the entire transaction if auth changed.
    db.prepare('DELETE FROM company_employee_write_guards WHERE id=?').bind(guardId),
    db.prepare([
      'INSERT INTO users(id,login,email,display_name,password_hash,',
      'role,employee_id,active,must_change_password,',
      'employee_temporary_password_expires_at,created_at,updated_at)',
      'VALUES (?,?,NULL,?,?,\'employee\',?,1,1,?,?,?)'
    ].join(' ')).bind(userId,'cpf-'+employeeId,input.full_name,
      passwordHash,employeeId,expiresAt,now,now),
    db.prepare([
      'INSERT INTO employee_cpf_links(',
      'employee_id,company_id,cpf_lookup_key,created_at,updated_at)',
      'VALUES(?,?,?,?,?)'
    ].join(' ')).bind(employeeId,company.id,cpfKey,now,now),
    db.prepare([
      'INSERT INTO company_employee_registration_audit(',
      'id,company_id,employee_id,admin_id,action,created_at)',
      'VALUES(?,?,?,?,\'created\',?)'
    ].join(' ')).bind(crypto.randomUUID(),company.id,employeeId,adminId,now)
  ];
  try {
    await db.batch(batch);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(message.includes('company_employee_write_conflict')){
      throw new ApiError(409,'employee_registration_conflict',
        'A sessão ou a empresa foi alterada. Entre novamente.');
    }
    if(message.includes('UNIQUE constraint failed')||
       message.includes('constraint failed: UNIQUE')){
      throw new ApiError(409,'duplicate_employee',
        'CPF ou matrícula já está cadastrado nesta empresa.');
    }
    throw error;
  }
  c.header('Cache-Control','private, no-store');
  c.header('Pragma','no-cache');
  return c.json({
    success:true,company_id:company.id,
    employee:{id:employeeId,full_name:input.full_name,
      registration:input.registration,status:'active',job_title:input.job_title,updated_at:now},
    temporary_password:temporaryPassword,expires_at:expiresAt,
    must_change_password:true
  },201);
});

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
        COALESCE(company_registration,registration) AS registration,
        job_title,
        admission_date,
        employment_end,
        status,
        updated_at,
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
    recovery_available: c.env.ENABLE_EMPLOYEE_PASSWORD_RECOVERY === 'true',
    registration_available: c.env.ENABLE_COMPANY_EMPLOYEE_REGISTRATION === 'true'
  });
});

// Alterações cadastrais sem modificar CPF, vínculo ou jornadas históricas.
companyEmployeesRoutes.patch('/:id', async c => {
  ensure(c.env.ENABLE_COMPANY_EMPLOYEE_REGISTRATION==='true',503,
    'employee_edit_unavailable','A edição está em homologação.');
  const company=c.get('company')!,adminId=c.get('companyAdminId')!;
  const token=c.get('companyAdminTokenHash')!;
  ensure(new URL(c.req.url).search==='',400,'invalid_employee','Filtros não são aceitos nesta operação.');
  const parsed=z.object({full_name:z.string().trim().min(3).max(140),
    job_title:z.string().trim().max(100),expected_updated_at:z.number().int().nonnegative()})
    .strict().safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_employee','Confira o nome e o cargo do funcionário.');
  await limit(c,'employee-edit:'+company.id+':'+adminId,60,3600000);
  const db=c.get('db'),employeeId=c.req.param('id');
  const previous=await db.prepare('SELECT full_name,job_title,updated_at FROM employees WHERE id=? AND company_id=? AND deleted_at IS NULL')
    .bind(employeeId,company.id).first<{full_name:string;job_title:string;updated_at:number}>();
  ensure(previous,404,'employee_not_found','Funcionário não encontrado nesta empresa.');
  const input=parsed.data;
  ensure(previous.updated_at===input.expected_updated_at,409,'employee_edit_conflict',
    'O cadastro foi alterado. Atualize a lista antes de editar novamente.');
  const now=Date.now(),updatedAt=Math.max(now,previous.updated_at+1);
  await atomicIdentityWrite(db,[
    db.prepare(`UPDATE employees SET full_name=?,job_title=?,updated_at=?
      WHERE id=? AND company_id=? AND deleted_at IS NULL AND updated_at=?
      AND EXISTS(SELECT 1 FROM companies co WHERE co.id=employees.company_id AND co.status='active')
      AND ${VALID_COMPANY_ADMIN_WRITE_SQL}`)
      .bind(input.full_name,input.job_title,updatedAt,employeeId,company.id,previous.updated_at,
        ...companyAdminWriteParams(token,adminId,company.id,now)),
    db.prepare(`UPDATE users SET display_name=?,updated_at=? WHERE employee_id=? AND role='employee'
      AND EXISTS(SELECT 1 FROM employees e WHERE e.id=users.employee_id AND e.company_id=?)`)
      .bind(input.full_name,updatedAt,employeeId,company.id),
    db.prepare(`INSERT INTO audit_log(id,actor_id,action,entity_type,entity_id,details_json,ip_hash,created_at)
      VALUES(?,NULL,'company.employee.profile_updated','employee',?,?,?,?)`)
      .bind(crypto.randomUUID(),employeeId,JSON.stringify({company_id:company.id,admin_id:adminId,
        before:{full_name:previous.full_name,job_title:previous.job_title},
        after:{full_name:input.full_name,job_title:input.job_title}}),ipHash(c),now)
  ],'employee_edit_conflict');
  return c.json({success:true,company_id:company.id,employee:{id:employeeId,
    full_name:input.full_name,job_title:input.job_title,updated_at:updatedAt}});
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
