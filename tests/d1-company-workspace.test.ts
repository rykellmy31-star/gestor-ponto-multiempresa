import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import server from '../server/index';
import {sha256} from '../server/core/crypto';
import {DEFAULT_RULES} from '../server/core/calculations';
describe('workspace multiempresa: rotas reais e todas as migrations',()=>{
 it('isola solicitações e pesquisa, protege decisões e preserva escalas arquivadas',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']}]}));
  try{
   const binding=await mf.getD1Database('DB'),db=binding.withSession();
   const migrations=JSON.parse(execFileSync('python3',['-c',`
import json,sqlite3,re
from pathlib import Path
files=[]
for p in sorted(Path('migrations').glob('*.sql')):
 statements=[];pending=''
 for c in p.read_text():
  pending+=c
  if c==';' and sqlite3.complete_statement(pending):
   clean=re.sub(r'^\\s*(?:--[^\\n]*\\n\\s*)*','',pending)
   if not re.match(r'^(PRAGMA|BEGIN|COMMIT)\\b',clean,re.I): statements.append(pending)
   pending=''
 files.append(statements)
print(json.dumps(files))`],{encoding:'utf8'})) as string[][];
   expect(migrations.length).toBe(43);
   for(const statements of migrations)if(statements.length)await db.batch(statements.map(s=>db.prepare(s)));
   const now=Date.now(),employeeTokens=['1','2','3','4'].map(n=>n.repeat(64));
   const schedule={start:'00:00',break_start:'11:00',break_end:'12:00',end:'23:00',weekdays:[0,1,2,3,4,5,6],paid_break:false};
   for(const co of ['a','b']){
    await db.prepare('INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(co,'QA '+co,'','qa-'+co,now,now).run();
    await db.prepare('INSERT INTO company_admins(id,company_id,login,display_name,password_hash,created_at,updated_at,must_change_password) VALUES(?,?,\'gestor\',\'QA\',\'fixture\',?,?,0)').bind('admin-'+co,co,now,now).run();
    await db.prepare('INSERT INTO company_admin_sessions(token_hash,admin_id,company_id,csrf_token,created_at,expires_at,last_seen_at,auth_version) VALUES(?,?,?,\'csrf\',?,?,?,0)').bind(sha256(co.repeat(64)),'admin-'+co,co,now,now+600000,now).run();
    await db.prepare('INSERT INTO schedules(id,name,config_json,company_id,created_at) VALUES(?,?,?,?,?)').bind('schedule-'+co,'Jornada '+co,JSON.stringify(schedule),co,now).run();
   }
   for(let i=0;i<4;i++){
    const id='e'+i,co=i===3?'b':'a';
    await db.prepare('INSERT INTO employees(id,company_id,full_name,registration,company_registration,admission_date,created_at,updated_at) VALUES(?,?,?,?,?,\'2026-01-01\',?,?)').bind(id,co,'Pessoa '+i,id,id,now,now).run();
    await db.prepare('INSERT INTO users(id,login,display_name,password_hash,role,employee_id,created_at,updated_at) VALUES(?,?,?,\'fixture\',\'employee\',?,?,?)').bind('u'+i,'u'+i,'Pessoa '+i,id,now,now).run();
    await db.prepare('INSERT INTO employee_cpf_links(employee_id,company_id,cpf_lookup_key,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,co,String(i).repeat(64),now,now).run();
    await db.prepare('INSERT INTO employee_company_sessions(token_hash,user_id,employee_id,company_id,csrf_token,created_at,expires_at,last_seen_at,auth_version) VALUES(?,?,?,?,\'csrf\',?,?,?,1)').bind(sha256(employeeTokens[i]),'u'+i,id,co,now,now+600000,now).run();
    await db.prepare('INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES(?,?,?,\'2026-01-01\',?)').bind('assign'+i,id,'schedule-'+co,now).run();
   }
   const env={DB:binding,ENVIRONMENT:'development',AUTH_PEPPER:'qa-workspace-pepper-only-for-testing',DATA_KEY:'a'.repeat(64),ENABLE_COMPANY_SCHEDULES:'true',ENABLE_EMPLOYEE_PUNCHES:'true'} as any;
   const call=(path:string,body?:object,who='e0',method=body?'POST':'GET',csrf='csrf')=>server.request('/api/'+path,{
    method,headers:{Origin:'http://localhost','Content-Type':'application/json','X-CSRF-Token':csrf,
     Cookie:who.startsWith('e')?'cr_jornada_employee_dev='+employeeTokens[Number(who.slice(1))]:'cr_jornada_company_dev='+who.repeat(64)},...(body?{body:JSON.stringify(body)}:{})},env);
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const request={work_date:today,message:'Justificativa fictícia de ausência'};
   expect((await call('employee/cpf-work/requests',request,'e0','POST','bad')).status).toBe(403);
   const created=await call('employee/cpf-work/requests',request);expect(created.status).toBe(201);
   const id=(await created.json() as any).id;
   expect((await call('employee/cpf-work/requests',request)).status).toBe(409);
   expect((await (await call('company/workspace/requests',undefined,'b')).json() as any).requests).toHaveLength(0);
   expect((await (await call('employee/cpf-work/requests',undefined,'e1')).json() as any).requests).toHaveLength(0);
   const answer={decision:'accepted',response:'Recebida. A conferência do ponto será feita pelo RH.'};
   expect((await call('company/workspace/requests/'+id+'/decision',answer,'b')).status).toBe(409);
   expect((await call('company/workspace/requests/'+id+'/decision',answer,'a','POST','bad')).status).toBe(403);
   expect((await call('company/workspace/requests/'+id+'/decision',answer,'a')).status).toBe(200);
   expect((await call('company/workspace/requests/'+id+'/decision',answer,'a')).status).toBe(409);
   expect((await (await call('employee/cpf-work/requests')).json() as any).requests[0]).toMatchObject({decision:'accepted',response:answer.response});
   expect((await db.prepare('SELECT COUNT(*) n FROM punches').first<any>()).n).toBe(0);
   expect((await call('employee/cpf-work/requests?company_id=b')).status).toBe(400);
   expect((await call('employee/cpf-work/mood',{mood:'good'})).status).toBe(201);
   expect((await call('employee/cpf-work/mood',{mood:'sad'})).status).toBe(409);
   await expect(db.prepare("INSERT OR REPLACE INTO company_employee_moods(id,company_id,employee_id,work_date,mood,created_at) VALUES('other-id','a','e0',?,'sad',?)").bind(today,now).run()).rejects.toThrow();
   await expect(db.prepare("INSERT INTO company_employee_moods(id,company_id,employee_id,work_date,mood,created_at) VALUES('cross-company','b','e0',?,'sad',?)").bind(today,now).run()).rejects.toThrow();
   expect((await (await call('company/workspace/mood',undefined,'a')).json() as any).results).toEqual([]);
   for(const who of ['e1','e2','e3'])expect((await call('employee/cpf-work/mood',{mood:'good'},who)).status).toBe(201);
   const aggregate=await (await call('company/workspace/mood',undefined,'a')).json() as any;
   expect(aggregate.results).toEqual([{mood:'good',total:3}]);expect(JSON.stringify(aggregate)).not.toMatch(/Pessoa|employee_id/);
   expect((await (await call('company/workspace/mood',undefined,'b')).json() as any).results).toEqual([]);
   const overview=await call('company/reports/overview?date='+today+'&month='+today.slice(0,7),undefined,'a');
   expect(overview.status).toBe(200);const dashboard=await overview.json() as any;expect(JSON.stringify(dashboard)).not.toContain('Pessoa 3');expect(dashboard.counts.pending).toBe(0);expect(dashboard.rows[0].day.schedule_name).toBe('Jornada a');
   const clock=await call('employee/cpf-work/today');expect(clock.status).toBe(200);
   expect(await clock.json()).toMatchObject({can_punch:false,schedule:{start:'00:00'},blocked:{code:'company_punch_disabled'}});
   expect((await call('employee/cpf-work/punch',{type:'entry',idempotency_key:crypto.randomUUID()})).status).toBe(409);
   expect((await call('company/schedules/schedule-a',undefined,'b','DELETE')).status).toBe(409);
   expect((await call('company/schedules/schedule-a',undefined,'a','DELETE','bad')).status).toBe(403);
   expect((await call('company/schedules/schedule-a',undefined,'a','DELETE')).status).toBe(200);
   expect((await (await call('company/schedules',undefined,'a')).json() as any).schedules).toEqual([]);
   const week=await (await call('company/schedules/employee/e0/week?from='+today,undefined,'a')).json() as any;
   expect(week.days[0]).toMatchObject({assignment_id:'assign0',schedule_name:'Jornada a'});
   expect((await db.prepare("SELECT COUNT(*) n FROM company_workspace_audit WHERE company_id='a'").first<any>()).n).toBe(1);
   await expect(db.prepare('UPDATE company_request_decisions SET response=\'alterada\'').run()).rejects.toThrow();
   await expect(db.prepare("INSERT OR REPLACE INTO company_request_decisions(request_id,company_id,admin_id,decision,response,created_at) VALUES(?,'a','admin-a','rejected','Alterada',?)").bind(id,now).run()).rejects.toThrow();
   // Suspension after middleware, immediately before the write statement.
   env.DB={withSession:()=>({prepare(sql:string){
    const statement=db.prepare(sql);if(!sql.includes('INSERT INTO company_employee_requests'))return statement;
    let bound=statement;return {bind(...values:any[]){bound=statement.bind(...values);return this;},async run(){
     await db.prepare("UPDATE companies SET status='suspended' WHERE id='a'").run();return bound.run();
    }};
   }})};
   expect((await call('employee/cpf-work/requests',{work_date:today,message:'Não gravar após suspensão'})).status).toBe(409);
   expect((await db.prepare("SELECT COUNT(*) n FROM company_employee_requests WHERE message='Não gravar após suspensão'").first<any>()).n).toBe(0);
   env.DB=binding;
   expect((await call('employee/cpf-work/mood')).status).toBe(401);
   expect((await call('company/workspace/requests',undefined,'a')).status).toBe(401);
  }finally{await mf.dispose();}
 },60000);
});
