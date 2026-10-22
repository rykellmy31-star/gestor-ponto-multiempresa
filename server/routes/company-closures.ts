import { Hono } from 'hono';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { App,Ctx } from '../types';
import { ensure } from '../core/errors';
import { sha256,verifyPassword } from '../core/crypto';
import { limit } from '../core/security';
import { atomicIdentityWrite } from '../core/atomic-identity-write';
import { VALID_COMPANY_ADMIN_WRITE_SQL,companyAdminWriteParams } from '../core/company-admin-write-guard';
import { requireCompanyAdmin } from './company-auth';
import { loadCompanyCalculation } from './company-calculations';

type Closure={id:string;company_id:string;employee_id:string;month:string;revision:number;state:'closed'|'open';snapshot_json:string|null;snapshot_hash:string|null;reason:string;admin_id:string;created_at:number};
const period={employee_id:z.string().min(1).max(128),month:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)};
async function readClosure(c:Ctx,employee:string,month:string) {
  const co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!;
  const rows=await c.get('db').batch([
    c.get('db').prepare(`SELECT e.id FROM employees e JOIN companies co ON co.id=e.company_id WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL AND co.status='active' AND ${VALID_COMPANY_ADMIN_WRITE_SQL}`)
      .bind(employee,co.id,...companyAdminWriteParams(token,admin,co.id,Date.now())),
    c.get('db').prepare('SELECT * FROM company_monthly_closures WHERE company_id=? AND employee_id=? AND month=? ORDER BY revision DESC LIMIT 1').bind(co.id,employee,month)
  ]);
  ensure(rows[0].results.length===1,404,'employee_not_found','Funcionário não encontrado nesta empresa.');
  const latest=rows[1].results[0] as Closure|undefined;
  if(latest?.snapshot_json)ensure(sha256(latest.snapshot_json)===latest.snapshot_hash,409,'closure_integrity','O fechamento exige conferência de integridade.');
  return latest;
}
export function closureReadiness(data:Awaited<ReturnType<typeof loadCompanyCalculation>>,now=Date.now()) {
  const problems:string[]=[];
  if(data.month>=DateTime.fromMillis(now,{zone:data.employee.timezone}).toFormat('yyyy-MM'))problems.push('Aguarde o encerramento do mês no fuso da empresa.');
  if(data.coverage.review_days>0)problems.push('Existem dias sem histórico suficiente; faça a conciliação antes de fechar.');
  if(data.coverage.future_days>0)problems.push('Existem datas futuras.');
  if(data.days.some(d=>d.result&&(d.result.incomplete||['working','on_break','not_started'].includes(d.result.status))))problems.push('Existem dias abertos ou incompletos.');
  if(data.days.some(d=>{const n=d.result?.raw_marks.filter(m=>m!==null).length??0;return n>0&&n<4;}))problems.push('Existem turnos originais incompletos; confira o fluxo de ponto antes de fechar.');
  if(data.totals.overtime_pending_minutes>0||data.totals.pending_occurrences>0)problems.push('Existem horas extras ou ocorrências pendentes de decisão.');
  if(data.coverage.calculated_days===0)problems.push('Não há dias calculados neste período.');
  return problems;
}
export const companyClosuresRoutes=new Hono<App>();
companyClosuresRoutes.use('*',requireCompanyAdmin);
companyClosuresRoutes.use('*',async(c,next)=>{
  ensure(c.env.ENABLE_COMPANY_SCHEDULES==='true',503,'closures_unavailable','Fechamento em homologação.');
  c.header('Cache-Control','private, no-store');await next();
});
companyClosuresRoutes.get('/',async c=>{
  ensure(Object.entries(c.req.queries()).every(([k,v])=>['employee_id','month'].includes(k)&&v.length===1),400,'invalid_period','Confira os filtros.');
  const parsed=z.object(period).strict().safeParse(c.req.query());
  ensure(parsed.success,400,'invalid_period','Selecione funcionário e mês.');
  const {employee_id,month}=parsed.data;
  const latest=await readClosure(c,employee_id,month);
  if(latest?.state==='closed')return c.json({company_id:latest.company_id,employee_id,month,revision:latest.revision,state:'closed',snapshot_hash:latest.snapshot_hash,closed_at:latest.created_at,report:JSON.parse(latest.snapshot_json!),problems:[]});
  const report=await loadCompanyCalculation(c,employee_id,month);
  return c.json({company_id:report.company_id,employee_id,month,revision:latest?.revision??0,state:'open',report,problems:closureReadiness(report)});
});
companyClosuresRoutes.post('/',async c=>{
  ensure(new URL(c.req.url).search==='',400,'invalid_period','Não informe filtros nesta operação.');
  const parsed=z.object({...period,state:z.enum(['closed','open']),expected_revision:z.number().int().min(0),
    expected_source_version:z.number().int().min(0).optional(),reason:z.string().trim().min(10).max(500),current_password:z.string().min(1).max(128)}).strict()
    .safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_closure','Confira período, motivo e senha.');
  const input=parsed.data,co=c.get('company')!,admin=c.get('companyAdminId')!,token=c.get('companyAdminTokenHash')!,db=c.get('db');
  await limit(c,'closure:'+co.id+':'+admin,15,3600000);
  const latest=await readClosure(c,input.employee_id,input.month);
  ensure((latest?.revision??0)===input.expected_revision&&(latest?.state??'open')!==input.state,409,'closure_conflict','O período mudou. Consulte novamente.');
  const manager=await db.prepare('SELECT password_hash FROM company_admins WHERE id=? AND company_id=? AND active=1 AND must_change_password=0').bind(admin,co.id).first<{password_hash:string}>();
  ensure(manager&&await verifyPassword(input.current_password,manager.password_hash,c.env.AUTH_PEPPER),403,'invalid_password','Não foi possível confirmar sua identidade.');
  let snapshot:string|null=null,hash:string|null=null,sourceVersion:number|null=null;
  if(input.state==='closed'){
    const report=await loadCompanyCalculation(c,input.employee_id,input.month);
    ensure(closureReadiness(report).length===0,409,'closure_not_ready','Confira as pendências do período antes de fechar.');
    ensure(report.source_version===input.expected_source_version,409,'closure_source_changed','Os dados mudaram desde a conferência. Consulte novamente.');
    sourceVersion=report.source_version;snapshot=JSON.stringify({...report,provisional:false,notice:'Fechamento mensal conferido pelo administrador. Snapshot imutável; não substitui documentos legais específicos.'});hash=sha256(snapshot);
  }
  const now=Date.now(),revision=input.expected_revision+1;
  await atomicIdentityWrite(db,[db.prepare(`INSERT INTO company_monthly_closures(id,company_id,employee_id,month,revision,state,snapshot_json,snapshot_hash,reason,admin_id,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE
    COALESCE((SELECT MAX(revision) FROM company_monthly_closures WHERE company_id=? AND employee_id=? AND month=?),0)=?
    AND (? IS NULL OR EXISTS(SELECT 1 FROM company_report_clock WHERE company_id=? AND version=?))
    AND EXISTS(SELECT 1 FROM employees e JOIN companies co ON co.id=e.company_id WHERE e.id=? AND e.company_id=? AND e.deleted_at IS NULL AND co.status='active')
    AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
    AND EXISTS(SELECT 1 FROM company_admins WHERE id=? AND company_id=? AND password_hash=?)`)
    .bind(crypto.randomUUID(),co.id,input.employee_id,input.month,revision,input.state,snapshot,hash,input.reason,admin,now,
      co.id,input.employee_id,input.month,input.expected_revision,sourceVersion,co.id,sourceVersion,input.employee_id,co.id,
      ...companyAdminWriteParams(token,admin,co.id,now),admin,co.id,manager.password_hash)],'closure_conflict');
  return c.json({success:true,company_id:co.id,employee_id:input.employee_id,month:input.month,revision,state:input.state,snapshot_hash:hash},201);
});
