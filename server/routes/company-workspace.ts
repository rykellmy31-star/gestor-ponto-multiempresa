import { Hono } from 'hono';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { App, Ctx } from '../types';
import { ensure } from '../core/errors';
import { safeEqual } from '../core/crypto';
import { limit } from '../core/security';
import { getEmployeeCpfSession, type ActiveSession } from './employee-cpf-auth';
import { requireCompanyAdmin } from './company-auth';
import { VALID_COMPANY_ADMIN_WRITE_SQL, companyAdminWriteParams } from '../core/company-admin-write-guard';
import { companyAdminWrite } from '../core/company-admin-write';
const adminGuard=VALID_COMPANY_ADMIN_WRITE_SQL+" AND EXISTS(SELECT 1 FROM companies WHERE id=? AND status='active')";
export const employeeWorkspaceRoutes=new Hono<App>();
export const companyWorkspaceRoutes=new Hono<App>();
companyWorkspaceRoutes.use('*',requireCompanyAdmin);
const date=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/).refine(v=>DateTime.fromISO(v).isValid);
const mood=z.enum(['very_happy','good','neutral','sad','stressed']);
function ready(c:Ctx){
 ensure(c.env.ENABLE_COMPANY_SCHEDULES==='true',503,'workspace_unavailable','Área ainda não liberada.');
 ensure(Object.keys(c.req.queries()).length===0,400,'invalid_query','A empresa é identificada pela sessão.');
 c.header('Cache-Control','private, no-store');
}
async function employee(c:Ctx,write=false){
 ready(c);const s=await getEmployeeCpfSession(c);
 ensure(s,401,'unauthenticated','Entre novamente.');
 ensure(!s.must_change_password,403,'password_change_required','Altere sua senha inicial.');
 if(write){ensure(safeEqual(c.req.header('X-CSRF-Token')||'',s.csrf_token),403,'csrf','Atualize sua sessão.');
  await limit(c,'employee-workspace:'+s.company_id+':'+s.employee_id,20,3600000);}
 return s;
}
// The identity is checked again by every statement, after middleware.
const employeeGuard=`EXISTS(SELECT 1 FROM employee_company_sessions sess
 JOIN users u ON u.id=sess.user_id AND u.employee_id=sess.employee_id AND u.auth_version=sess.auth_version AND u.active=1 AND u.role='employee'
 JOIN employees e ON e.id=sess.employee_id AND e.company_id=sess.company_id AND e.status='active' AND e.deleted_at IS NULL
 JOIN companies co ON co.id=e.company_id AND co.status='active'
 JOIN employee_cpf_links l ON l.employee_id=e.id AND l.company_id=co.id
 WHERE sess.token_hash=? AND sess.company_id=? AND sess.employee_id=? AND sess.expires_at>? AND sess.last_seen_at>? AND (u.employee_temporary_password_expires_at IS NULL OR u.employee_temporary_password_expires_at>?))`;
function employeeParams(s:ActiveSession){const now=Date.now();return [s.token_hash,s.company_id,s.employee_id,now,now-3600000,now];}
employeeWorkspaceRoutes.get('/mood',async c=>{
 const s=await employee(c),today=DateTime.now().setZone(s.company_timezone).toISODate()!;
 const row=await c.get('db').prepare(`SELECT mood FROM company_employee_moods WHERE company_id=? AND employee_id=? AND work_date=? AND ${employeeGuard}`)
 .bind(s.company_id,s.employee_id,today,...employeeParams(s)).first<{mood:string}>();
 return c.json({company_id:s.company_id,employee_id:s.employee_id,date:today,mood:row?.mood??null});
});
employeeWorkspaceRoutes.post('/mood',async c=>{
 const s=await employee(c,true),p=z.object({mood}).strict().safeParse(await c.req.json().catch(()=>null));
 ensure(p.success,400,'invalid_mood','Escolha uma das opções.');
 const today=DateTime.now().setZone(s.company_timezone).toISODate()!;
 const result=await c.get('db').prepare(`INSERT INTO company_employee_moods(id,company_id,employee_id,work_date,mood,created_at)
 SELECT ?,?,?,?,?,? WHERE ${employeeGuard} AND NOT EXISTS(SELECT 1 FROM company_employee_moods WHERE company_id=? AND employee_id=? AND work_date=?) ON CONFLICT(company_id,employee_id,work_date) DO NOTHING`)
 .bind(crypto.randomUUID(),s.company_id,s.employee_id,today,p.data.mood,Date.now(),...employeeParams(s),s.company_id,s.employee_id,today).run();
 ensure(result.meta.changes>0,409,'mood_already_answered','A resposta de hoje já foi registrada ou a sessão mudou.');
 return c.json({success:true,company_id:s.company_id},201);
});
employeeWorkspaceRoutes.get('/requests',async c=>{
 const s=await employee(c);
 const result=await c.get('db').prepare(`SELECT r.id,r.work_date,r.message,r.created_at,d.decision,d.response
 FROM company_employee_requests r LEFT JOIN company_request_decisions d ON d.request_id=r.id AND d.company_id=r.company_id
 WHERE r.company_id=? AND r.employee_id=? AND ${employeeGuard} ORDER BY r.created_at DESC,r.id LIMIT 100`)
 .bind(s.company_id,s.employee_id,...employeeParams(s)).all();
 return c.json({company_id:s.company_id,employee_id:s.employee_id,requests:result.results||[]});
});
employeeWorkspaceRoutes.post('/requests',async c=>{
 const s=await employee(c,true),p=z.object({work_date:date,message:z.string().trim().min(3).max(2000)}).strict().safeParse(await c.req.json().catch(()=>null));
 ensure(p.success,400,'invalid_request','Informe data e justificativa válidas.');
 const today=DateTime.now().setZone(s.company_timezone).toISODate()!;
 ensure(p.data.work_date<=today,400,'future_request','Selecione hoje ou uma data anterior.');
 const id=crypto.randomUUID();
 const result=await c.get('db').prepare(`INSERT INTO company_employee_requests(id,company_id,employee_id,work_date,message,created_at)
 SELECT ?,?,?,?,?,? WHERE ${employeeGuard} AND NOT EXISTS(SELECT 1 FROM company_employee_requests WHERE company_id=? AND employee_id=? AND work_date=? AND message=?) ON CONFLICT(company_id,employee_id,work_date,message) DO NOTHING`)
 .bind(id,s.company_id,s.employee_id,p.data.work_date,p.data.message,Date.now(),...employeeParams(s),s.company_id,s.employee_id,p.data.work_date,p.data.message).run();
 ensure(result.meta.changes>0,409,'request_exists','Esta justificativa já foi enviada ou a sessão mudou. Atualize a lista.');
 return c.json({success:true,id,company_id:s.company_id},201);
});
companyWorkspaceRoutes.use('*',async(c,next)=>{ready(c);await next();});
companyWorkspaceRoutes.get('/mood',async c=>{
 const co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
 const clock=await c.get('db').prepare(`SELECT timezone FROM companies WHERE id=? AND status='active' AND ${VALID_COMPANY_ADMIN_WRITE_SQL}`)
 .bind(co.id,...companyAdminWriteParams(token,admin,co.id,Date.now())).first<{timezone:string}>();
 ensure(clock,401,'unauthenticated','Entre novamente.');
 const from=DateTime.now().setZone(clock.timezone).minus({days:6}).toISODate()!;
 const rows=await c.get('db').prepare(`SELECT m.mood,COUNT(*) AS total FROM company_employee_moods m
 WHERE m.company_id=? AND m.work_date>=? AND ${adminGuard}
 AND (SELECT COUNT(DISTINCT employee_id) FROM company_employee_moods WHERE company_id=m.company_id AND work_date>=?)>=3 GROUP BY m.mood`)
 .bind(co.id,from,...companyAdminWriteParams(token,admin,co.id,Date.now()),co.id,from).all();
 return c.json({company_id:co.id,period:'last_7_days',minimum_participants:3,results:rows.results||[]});
});
companyWorkspaceRoutes.get('/requests',async c=>{
 const co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
 const result=await c.get('db').prepare(`SELECT r.id,r.employee_id,e.full_name,r.work_date,r.message,r.created_at,d.decision,d.response
 FROM company_employee_requests r JOIN employees e ON e.id=r.employee_id AND e.company_id=r.company_id
 LEFT JOIN company_request_decisions d ON d.request_id=r.id AND d.company_id=r.company_id
 WHERE r.company_id=? AND ${adminGuard} ORDER BY r.created_at DESC,r.id LIMIT 200`)
 .bind(co.id,...companyAdminWriteParams(token,admin,co.id,Date.now()),co.id).all();
 return c.json({company_id:co.id,requests:result.results||[]});
});
companyWorkspaceRoutes.post('/requests/:id/decision',async c=>{
 const co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
 await limit(c,'company-request-decision:'+co.id+':'+admin,30,3600000);
 const p=z.object({decision:z.enum(['accepted','rejected']),response:z.string().trim().min(3).max(1000)}).strict().safeParse(await c.req.json().catch(()=>null));
 ensure(p.success,400,'invalid_decision','Informe decisão e resposta.');
 await companyAdminWrite(c.get('db'),[c.get('db').prepare(`INSERT INTO company_request_decisions(request_id,company_id,admin_id,decision,response,created_at)
 SELECT r.id,r.company_id,?,?,?,? FROM company_employee_requests r WHERE r.id=? AND r.company_id=?
 AND NOT EXISTS(SELECT 1 FROM company_request_decisions WHERE request_id=r.id) AND ${adminGuard}`)
 .bind(admin,p.data.decision,p.data.response,Date.now(),c.req.param('id'),co.id,...companyAdminWriteParams(token,admin,co.id,Date.now()),co.id)],'request_decision_conflict');
 return c.json({success:true,company_id:co.id});
});
