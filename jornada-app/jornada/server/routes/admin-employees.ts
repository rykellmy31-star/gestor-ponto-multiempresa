import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App } from '../types';
import { auditStatement, requireRecent } from '../core/security';
import { body, date, employeeSchema, login, parse, password, scheduleSchema, uuid } from '../core/validation';
import { ensure } from '../core/errors';
import { encryptPersonal, hashPassword, randomToken, sha256 } from '../core/crypto';
import { localDate, scheduleMinutes } from '../core/time';
export const adminEmployees=new Hono<App>();
adminEmployees.get('/employees',async c=>{
  const config=await c.get('db').prepare('SELECT timezone FROM settings WHERE id=1').first<{timezone:string}>(),today=localDate(Date.now(),config!.timezone);
  const rows=await c.get('db').prepare(`SELECT e.*,u.id user_id,u.login,u.email,u.active user_active,u.must_change_password,(SELECT s.name FROM schedule_assignments a JOIN schedules s ON s.id=a.schedule_id WHERE a.employee_id=e.id AND a.effective_from<=? ORDER BY a.effective_from DESC LIMIT 1) schedule_name FROM employees e JOIN users u ON u.employee_id=e.id ORDER BY e.full_name`).bind(today).all<any>();
  return c.json(rows.results.map(({cpf_encrypted,...r})=>r));
});
adminEmployees.post('/employees',async c=>{
  const input=await body(c,employeeSchema.extend({initial_password:password,schedule_id:uuid}).strict());
  const db=c.get('db'),now=Date.now(),employeeId=crypto.randomUUID(),userId=crypto.randomUUID();
  const exists=await db.prepare('SELECT id FROM schedules WHERE id=?').bind(input.schedule_id).first();ensure(exists,422,'invalid_schedule','Selecione uma jornada válida.');
  let end=input.employment_end||null;ensure(input.status!=='terminated'||end,422,'employment_end_required','Informe a data de desligamento.');
  ensure(!end||end>=input.admission_date,422,'invalid_employment_end','O desligamento deve ser posterior à admissão.');
  const hash=await hashPassword(input.initial_password,c.env.AUTH_PEPPER),cpf=input.cpf?await encryptPersonal(input.cpf,c.env.DATA_KEY):null;
  await db.batch([
    db.prepare('INSERT INTO employees(id,full_name,registration,cpf_encrypted,cpf_last4,job_title,admission_date,employment_end,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(employeeId,input.full_name,input.registration,cpf,input.cpf?.slice(-4)||null,input.job_title,input.admission_date,end,input.status,input.notes,now,now),
    db.prepare("INSERT INTO users(id,login,email,display_name,password_hash,role,employee_id,active,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,'employee',?,?,1,?,?)").bind(userId,input.login,input.email||null,input.full_name,hash,employeeId,input.status==='active'?1:0,now,now),
    db.prepare('INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),employeeId,input.schedule_id,input.admission_date,now),
    auditStatement(c,'employee.created','employee',employeeId,{registration:input.registration,schedule_id:input.schedule_id,status:input.status}),
  ]);
  return c.json({id:employeeId,message:'Funcionário e acesso criados. A senha inicial deverá ser alterada no primeiro acesso.'},201);
});
adminEmployees.get('/employees/:id',async c=>{
  const id=parse(uuid,c.req.param('id')),db=c.get('db');
  const employee=await db.prepare('SELECT e.*,u.id user_id,u.login,u.email,u.must_change_password FROM employees e JOIN users u ON u.employee_id=e.id WHERE e.id=?').bind(id).first<any>();
  ensure(employee,404,'employee_not_found','Funcionário não encontrado.');delete employee.cpf_encrypted;
  const assignments=await db.prepare('SELECT a.id,a.schedule_id,a.effective_from,s.name,s.config_json FROM schedule_assignments a JOIN schedules s ON s.id=a.schedule_id WHERE a.employee_id=? ORDER BY a.effective_from DESC').bind(id).all<any>();
  const history=await db.prepare('SELECT a.id,a.action,a.details_json,a.created_at,u.display_name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE (a.entity_type=\'employee\' AND a.entity_id=?) OR (a.entity_type=\'user\' AND a.entity_id=?) ORDER BY a.created_at DESC LIMIT 100').bind(id,employee.user_id).all();
  return c.json({employee,assignments:assignments.results.map(a=>({...a,config:JSON.parse(a.config_json)})),history:history.results});
});
adminEmployees.put('/employees/:id',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id'));
  const input=await body(c,employeeSchema.strict()),db=c.get('db'),now=Date.now();
  const old=await db.prepare('SELECT e.*,u.id user_id,u.login,u.email FROM employees e JOIN users u ON u.employee_id=e.id WHERE e.id=?').bind(id).first<any>();ensure(old,404,'employee_not_found','Funcionário não encontrado.');
  const end=input.employment_end||null;
  ensure(input.status!=='terminated'||end,422,'employment_end_required','Informe a data de desligamento.');
  ensure(!end||end>=input.admission_date,422,'invalid_employment_end','O desligamento deve ser posterior à admissão.');
  if(old.admission_date!==input.admission_date||old.employment_end!==end){const closed=await db.prepare("SELECT 1 ok FROM monthly_closures WHERE employee_id=? AND status='closed' LIMIT 1").bind(id).first();ensure(!closed,409,'period_closed','Reabra os períodos fechados antes de alterar datas do vínculo.');}
  const cpf=input.cpf?await encryptPersonal(input.cpf,c.env.DATA_KEY):null;
  const statements=[
    db.prepare('UPDATE employees SET full_name=?,registration=?,job_title=?,admission_date=?,employment_end=?,status=?,notes=?,updated_at=? WHERE id=?').bind(input.full_name,input.registration,input.job_title,input.admission_date,end,input.status,input.notes,now,id),
    db.prepare('UPDATE users SET login=?,email=?,display_name=?,active=?,updated_at=? WHERE id=?').bind(input.login,input.email||null,input.full_name,input.status==='active'?1:0,now,old.user_id),
  ];
  // CPF omitido preserva o valor; CPF vazio remove o dado. Nunca retorna o número completo ao navegador.
  if(input.cpf!==undefined)statements.push(db.prepare('UPDATE employees SET cpf_encrypted=?,cpf_last4=? WHERE id=?').bind(cpf,input.cpf?.slice(-4)||null,id));
  if(input.status!=='active')statements.push(db.prepare('DELETE FROM sessions WHERE user_id=?').bind(old.user_id));
  const after={...input,employment_end:end,email:input.email||null};
  const changed=['full_name','registration','job_title','admission_date','employment_end','status','login','email'] as const;
  const changes=Object.fromEntries(changed.filter(k=>(old[k]??null)!==(after[k]??null)).map(k=>[k,{before:old[k]??null,after:after[k]??null}]));
  statements.push(auditStatement(c,'employee.updated','employee',id,{changes,notes_changed:old.notes!==input.notes,status_from:old.status,status_to:input.status,cpf_changed:input.cpf!==undefined}));
  await db.batch(statements);return c.json({message:'Cadastro atualizado.'});
});
adminEmployees.post('/employees/:id/schedule',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id'));const input=await body(c,z.object({schedule_id:uuid,effective_from:date}).strict()),db=c.get('db');
  const config=await db.prepare('SELECT timezone FROM settings WHERE id=1').first<{timezone:string}>();const today=localDate(Date.now(),config!.timezone);
  ensure(input.effective_from>=today,422,'schedule_effective_date','Uma alteração de jornada só pode valer a partir de hoje. O histórico anterior é preservado.');
  const employee=await db.prepare('SELECT id FROM employees WHERE id=?').bind(id).first(),schedule=await db.prepare('SELECT id FROM schedules WHERE id=?').bind(input.schedule_id).first();
  ensure(employee&&schedule,404,'not_found','Funcionário ou jornada não encontrado.');
  await db.batch([
    db.prepare('INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,input.schedule_id,input.effective_from,Date.now()),
    auditStatement(c,'employee.schedule_assigned','employee',id,input),
  ]);return c.json({message:'Nova vigência atribuída. Dias já iniciados mantêm a jornada registrada no início do expediente.'},201);
});
adminEmployees.get('/schedules',async c=>{
  const rows=await c.get('db').prepare('SELECT * FROM schedules ORDER BY created_at DESC').all<any>();
  return c.json(rows.results.map(v=>{const config=JSON.parse(v.config_json);return {id:v.id,name:v.name,created_at:v.created_at,config,...scheduleMinutes(config)};}));
});
adminEmployees.post('/schedules',async c=>{
  const input=await body(c,z.object({name:z.string().trim().min(2).max(100),config:scheduleSchema}).strict()),id=crypto.randomUUID();
  await c.get('db').batch([
    c.get('db').prepare('INSERT INTO schedules(id,name,config_json,created_by,created_at) VALUES(?,?,?,?,?)').bind(id,input.name,JSON.stringify(input.config),c.get('principal').id,Date.now()),
    auditStatement(c,'schedule.created','schedule',id,{name:input.name,config:input.config}),
  ]);return c.json({id,message:'Jornada criada. Para alterar uma jornada em uso, crie outra versão e atribua uma nova vigência.'},201);
});
adminEmployees.get('/users',async c=>{
  const rows=await c.get('db').prepare('SELECT id,login,email,display_name,active,created_at FROM users WHERE role=\'admin\' ORDER BY display_name').all();return c.json(rows.results);
});
adminEmployees.post('/users',async c=>{
  requireRecent(c);const input=await body(c,z.object({name:z.string().trim().min(3).max(140),login,email:z.union([z.email(),z.literal('')]),initial_password:password}).strict());
  const id=crypto.randomUUID(),now=Date.now(),hash=await hashPassword(input.initial_password,c.env.AUTH_PEPPER);
  await c.get('db').batch([
    c.get('db').prepare('INSERT INTO users(id,login,email,display_name,password_hash,role,employee_id,active,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,\'admin\',NULL,1,1,?,?)').bind(id,input.login,input.email.toLowerCase()||null,input.name,hash,now,now),
    auditStatement(c,'admin.created','user',id,{login:input.login}),
  ]);return c.json({id,message:'Administrador autorizado cadastrado. Deve alterar a senha inicial.'},201);
});
adminEmployees.patch('/users/:id',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id')),input=await body(c,z.object({active:z.boolean()}).strict());
  ensure(id!==c.get('principal').id,409,'cannot_block_self','Não é permitido bloquear o próprio acesso.');
  const exists=await c.get('db').prepare("SELECT id FROM users WHERE id=? AND role='admin'").bind(id).first();ensure(exists,404,'user_not_found','Administrador não encontrado.');
  await c.get('db').batch([
    c.get('db').prepare("UPDATE users SET active=?,updated_at=? WHERE id=? AND role='admin'").bind(+input.active,Date.now(),id),
    c.get('db').prepare('DELETE FROM sessions WHERE user_id=?').bind(id),
    auditStatement(c,'admin.status_changed','user',id,{active:input.active}),
  ]);return c.json({message:'Permissão administrativa atualizada. Sessões anteriores foram revogadas.'});
});
adminEmployees.post('/users/:id/reset',async c=>{
  requireRecent(c);const id=parse(uuid,c.req.param('id'));await body(c,z.object({}).strict());
  const db=c.get('db'),user=await db.prepare('SELECT id,active FROM users WHERE id=?').bind(id).first<{id:string;active:number}>();ensure(user?.active,404,'user_not_found','Usuário ativo não encontrado.');
  const token=randomToken(),now=Date.now();
  await db.batch([
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').bind(id),
    db.prepare('INSERT INTO password_reset_tokens(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(sha256(token),id,now+30*60000,now),
    auditStatement(c,'auth.reset_issued','user',id,{expires_at:now+30*60000}),
  ]);
  return c.json({message:'Valide a identidade e entregue o link por um canal de confiança. O token é exibido somente agora.',reset_path:`/redefinir-senha#token=${token}`,expires_at:now+30*60000});
});
adminEmployees.get('/recovery-requests',async c=>{
  const rows=await c.get('db').prepare("SELECT r.id,r.user_id,r.created_at,u.display_name,u.login,u.role FROM recovery_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.created_at").all();return c.json(rows.results);
});
