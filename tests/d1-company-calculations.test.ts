import { describe,expect,it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { DateTime } from 'luxon';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import server from '../server/index';
import { closureReadiness } from '../server/routes/company-closures';
import { sha256,hashPassword } from '../server/core/crypto';
import { DEFAULT_RULES } from '../server/core/calculations';
const at=(date:string,time:string)=>DateTime.fromISO(date+'T'+time,{zone:'America/Bahia'}).toMillis();
describe('apuracao empresarial com 43 migrations reais no D1',()=>{
  it('isola dados, aplica snapshots, filtra cancelamentos e exige conciliacao de legado',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,
      script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']}]}));
    try {
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
print(json.dumps(files))
`],{encoding:'utf8'})) as string[][];
      expect(migrations).toHaveLength(43);
      for(const statements of migrations)if(statements.length)await db.batch(statements.map(s=>db.prepare(s)));
      const token='a'.repeat(64),now=Date.now(),created=at('2026-09-01','00:00');
      const schedule={start:'07:00',break_start:'11:00',break_end:'12:00',end:'16:00',weekdays:[1,2,3,4,5],paid_break:false};
      const rules=JSON.stringify(DEFAULT_RULES);
      await db.batch([
        db.prepare("INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('a','QA A','','qa-a',?,?),('b','QA B','','qa-b',?,?)").bind(created,created,created,created),
        db.prepare("INSERT INTO company_admins(id,company_id,login,display_name,password_hash,created_at,updated_at,must_change_password) VALUES('aa','a','gestor','QA A','fixture',?,?,0),('ab','b','gestor','QA B','fixture',?,?,0)").bind(created,created,created,created),
        db.prepare("INSERT INTO company_admin_sessions(token_hash,company_id,admin_id,csrf_token,created_at,expires_at,last_seen_at,auth_version) VALUES(?,'a','aa','csrf',?,?,?,0)").bind(sha256(token),now,now+600000,now),
        db.prepare("INSERT INTO employees(id,company_id,full_name,registration,company_registration,admission_date,created_at,updated_at) VALUES('ea','a','=Pessoa A','tech-a','001','2026-10-01',?,?),('eb','b','Segredo B','tech-b','001','2026-10-01',?,?)").bind(created,created,created,created),
        db.prepare("INSERT INTO company_punch_policies(company_id,enabled,rules_json,updated_at) VALUES('a',1,?,?),('b',1,?,?)").bind(rules,created,rules,created),
        db.prepare("INSERT INTO company_punch_policy_audit(id,company_id,admin_id,revision,enabled,rules_json,ip_hash,created_at) VALUES('audit-a','a','aa',1,1,?,'qa',?),('audit-b','b','ab',1,1,?,'qa',?)").bind(rules,created,rules,created),
        db.prepare("INSERT INTO schedules(id,name,config_json,created_at,company_id) VALUES('sa','Jornada A',?,?,'a'),('sb','Jornada B',?,?,'b')").bind(JSON.stringify(schedule),created,JSON.stringify(schedule),created),
        db.prepare("INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES('assign-a','ea','sa','2026-10-01',?),('assign-b','eb','sb','2026-10-01',?)").bind(created,created)
      ]);
      await db.prepare("INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,company_id,created_at) VALUES('da','ea','2026-10-05','America/Bahia',?,?,'a',?)").bind(JSON.stringify(schedule),rules,at('2026-10-05','07:12')).run();
      for(const [seq,time] of ['07:12','11:00','12:00','16:00'].entries())await db.prepare(`INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash) VALUES(?,'da','ea',?,?,?,?, 'qa','receipt')`)
        .bind('p'+seq,seq,['entry','break_start','break_end','exit'][seq],at('2026-10-05',time),'key'+seq).run();
      const env={DB:binding,ENVIRONMENT:'development',AUTH_PEPPER:'test-calculations'.repeat(3),DATA_KEY:'a'.repeat(64),ENABLE_COMPANY_SCHEDULES:'true'} as any;
      const call=(query='employee_id=ea&month=2026-10',auth=token)=>server.request('/api/company/reports/calculations?'+query,{headers:{Cookie:'cr_jornada_company_dev='+auth}},env);
      await db.batch([
        db.prepare("INSERT INTO employees(id,company_id,full_name,registration,company_registration,admission_date,created_at,updated_at) VALUES('ea2','a','Pessoa A2','tech-a2','002','2026-10-01',?,?)").bind(created,created),
        db.prepare("INSERT INTO schedules(id,name,config_json,created_at,company_id) VALUES('sa-afternoon','Tarde A',?,?,'a')").bind(JSON.stringify({...schedule,start:'13:00',break_start:'17:00',break_end:'18:00',end:'22:00'}),created),
        db.prepare("INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES('assign-a-afternoon','ea','sa-afternoon','2026-10-06',?),('assign-a2','ea2','sa-afternoon','2026-10-01',?)").bind(created,created)
      ]);
      const response=await call();expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      const data=await response.json() as any;
      expect(data.company_id).toBe('a');expect(data.provisional).toBe(true);
      expect(data.days[4]).toMatchObject({source:'snapshot',result:{late_minutes:12,worked_minutes:468,break_minutes:60}});
      expect(data.days[5]).toMatchObject({source:'policy_history',result:{absence:true,expected_minutes:480,schedule:{start:'13:00'}}});
      expect((await (await call('employee_id=ea2&month=2026-10')).json() as any).days[4].result.schedule.start).toBe('13:00');
      expect(JSON.stringify(data)).not.toMatch(/Segredo B|tech-a|qa-b/);
      expect((await call('employee_id=eb&month=2026-10')).status).toBe(404);
      expect((await call(undefined,'b'.repeat(64))).status).toBe(401);
      expect((await call('employee_id=ea&month=2026-10&company_id=b')).status).toBe(400);
      expect((await call('employee_id=ea&employee_id=eb&month=2026-10')).status).toBe(400);
      const csv=await call('employee_id=ea&month=2026-10&format=csv');
      expect(csv.headers.get('Content-Disposition')).toContain('apuracao-2026-10.csv');
      expect(await csv.text()).toContain('"\'=Pessoa A"');
      // Current rule changes cannot rewrite a started day's frozen tolerance.
      await db.prepare("UPDATE company_punch_policies SET rules_json=? WHERE company_id='a'").bind(JSON.stringify({...DEFAULT_RULES,mark_tolerance:30})).run();
      expect((await (await call()).json() as any).days[4].result.late_minutes).toBe(12);
      await db.prepare("INSERT INTO users(id,login,display_name,password_hash,role,created_at,updated_at) VALUES('legacy-admin','legacy-admin','QA','fixture','admin',?,?)").bind(now,now).run();
      await db.prepare("INSERT INTO schedule_assignment_cancellations(assignment_id,cancelled_by,reason,cancelled_at) VALUES('assign-a-afternoon','legacy-admin','Conferencia ficticia',?)").bind(now).run();
      const cancelled=await (await call()).json() as any;
      expect(cancelled.days[5].result.schedule.start).toBe('07:00');
      expect(cancelled.days[4].source).toBe('snapshot');
      const event=(body:object,csrf='csrf')=>server.request('/api/company/day-events',{
        method:'POST',headers:{Cookie:'cr_jornada_company_dev='+token,Origin:'http://localhost','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)
      },env);
      const holiday={kind:'holiday',work_date:'2026-10-05',expected_revision:0,reason:'Feriado fictício de homologação',value:{name:'Feriado QA'}};
      expect((await event(holiday,'invalid')).status).toBe(403);
      expect((await event({...holiday,company_id:'b'})).status).toBe(400);
      const savedHoliday=await event(holiday);expect(savedHoliday.status).toBe(201);
      const holidayId=(await savedHoliday.json() as any).id;
      expect((await event(holiday)).status).toBe(409);
      expect((await (await call()).json() as any).days[4].result.expected_minutes).toBe(0);
      expect((await (await call('employee_id=ea2&month=2026-10')).json() as any).days[4].result.expected_minutes).toBe(0);
      await expect(db.prepare("UPDATE company_day_events SET reason='Alteracao indevida' WHERE id=?").bind(holidayId).run()).rejects.toThrow();
      await expect(db.prepare('DELETE FROM company_day_events WHERE id=?').bind(holidayId).run()).rejects.toThrow();
      await expect(db.prepare('INSERT OR REPLACE INTO company_day_events SELECT * FROM company_day_events WHERE id=?').bind(holidayId).run()).rejects.toThrow();
      expect((await event({...holiday,expected_revision:1,value:null})).status).toBe(201);
      expect((await (await call()).json() as any).days[4].result.expected_minutes).toBe(480);
      const occurrence={kind:'occurrence',work_date:'2026-10-06',employee_id:'ea',expected_revision:0,
        reason:'Atestado fictício aprovado pelo gestor',value:{kind:'medical',paid:true}};
      expect((await event({...occurrence,employee_id:'eb'})).status).toBe(404);
      expect((await event(occurrence)).status).toBe(201);
      expect((await (await call()).json() as any).days[5].result).toMatchObject({credited_minutes:480,absence:false});
      const adjustment={kind:'adjustment',work_date:'2026-10-05',employee_id:'ea',expected_revision:0,
        reason:'Correcao fictícia conferida pelo gestor',value:{marks:['07:00','11:00','12:00','16:00'].map(t=>at('2026-10-05',t))}};
      expect((await event({...adjustment,value:{marks:[4,3,2,1]}})).status).toBe(400);
      expect((await event({...adjustment,work_date:'2026-10-06'})).status).toBe(400);
      expect((await event({...adjustment,employee_id:'ea2'})).status).toBe(409);
      expect((await event(adjustment)).status).toBe(201);
      const adjusted=(await (await call()).json() as any).days[4].result;
      expect(adjusted).toMatchObject({worked_minutes:480,late_minutes:0,adjusted:true});
      expect(adjusted.raw_marks[0]).toBe(at('2026-10-05','07:12'));
      expect((await db.prepare("SELECT recorded_at FROM punches WHERE id='p0'").first<any>()).recorded_at).toBe(at('2026-10-05','07:12'));
      const eventsRead=await server.request('/api/company/day-events?employee_id=ea&month=2026-10',{headers:{Cookie:'cr_jornada_company_dev='+token}},env);
      expect(eventsRead.status).toBe(200);expect((await eventsRead.json() as any).events).toHaveLength(3);
      // Close a fully covered past month, retaining prior snapshots on reopening.
      await db.prepare("UPDATE employees SET admission_date='2026-09-01',employment_end='2026-09-30' WHERE id='ea2'").run();
      await db.prepare("INSERT INTO schedule_assignments(id,employee_id,schedule_id,effective_from,created_at) VALUES('assign-a2-past','ea2','sa-afternoon','2026-09-01',?)").bind(created).run();
      // Historical fixture obeys the same active-owner guards as live punches.
      await db.prepare("INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,company_id,created_at) VALUES('historical','ea2','2026-09-01','America/Bahia',?,?,'a',?)").bind(JSON.stringify(schedule),rules,at('2026-09-01','07:00')).run();
      for(const [seq,time] of ['07:00','11:00','12:00','16:00'].entries())await db.prepare("INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash) VALUES(?,'historical','ea2',?,?,?,?, 'qa','receipt')")
        .bind('historical'+seq,seq,['entry','break_start','break_end','exit'][seq],at('2026-09-01',time),'historical-key'+seq).run();
      await db.prepare("UPDATE employees SET status='terminated' WHERE id='ea2'").run();
      await db.prepare("UPDATE company_admins SET password_hash=? WHERE id='aa'").bind(await hashPassword('Closure-QA!123',env.AUTH_PEPPER)).run();
      const closureGet=(employee='ea2',month='2026-09')=>server.request('/api/company/closures?employee_id='+employee+'&month='+month,{headers:{Cookie:'cr_jornada_company_dev='+token}},env);
      const closurePost=(body:object,csrf='csrf')=>server.request('/api/company/closures',{method:'POST',headers:{Cookie:'cr_jornada_company_dev='+token,Origin:'http://localhost','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)},env);
      expect((await closureGet('eb')).status).toBe(404);
      const preview=await (await closureGet()).json() as any;
      expect(preview.problems).toEqual([]);
      const incompleteOriginal=structuredClone(preview.report);
      const originalDay=incompleteOriginal.days.find((d:any)=>d.date==='2026-09-01');
      originalDay.result.raw_marks[3]=null;originalDay.result.adjusted=true;
      expect(closureReadiness(incompleteOriginal)).toContain('Existem turnos originais incompletos; confira o fluxo de ponto antes de fechar.');
      const closeBody={employee_id:'ea2',month:'2026-09',state:'closed',expected_revision:0,expected_source_version:preview.report.source_version,reason:'Conferencia ficticia do fechamento mensal',current_password:'Closure-QA!123'};
      expect((await closurePost(closeBody,'invalid')).status).toBe(403);
      expect((await closurePost({...closeBody,current_password:'wrong'})).status).toBe(403);
      expect((await event({...holiday,work_date:'2026-09-02'})).status).toBe(201);
      expect((await closurePost(closeBody)).status).toBe(409);
      const freshPreview=await (await closureGet()).json() as any;
      env.DB={withSession:()=>({prepare:(sql:string)=>db.prepare(sql),async batch(statements:any[]){
        if(statements.length===3)await db.prepare("UPDATE employees SET job_title='Alterado durante fechamento' WHERE id='ea2'").run();
        return db.batch(statements);
      }})};
      expect((await closurePost({...closeBody,expected_source_version:freshPreview.report.source_version})).status).toBe(409);
      env.DB=binding;
      const currentPreview=await (await closureGet()).json() as any;
      const concurrent=await Promise.all([closurePost({...closeBody,expected_source_version:currentPreview.report.source_version}),closurePost({...closeBody,expected_source_version:currentPreview.report.source_version})]);
      expect(concurrent.map(r=>r.status).sort()).toEqual([201,409]);
      const closed=await (await closureGet()).json() as any;
      expect(closed).toMatchObject({state:'closed',revision:1,report:{provisional:false}});
      expect(closed.snapshot_hash).toHaveLength(64);
      expect((await event({...holiday,work_date:'2026-09-03'})).status).toBe(409);
      await expect(db.prepare("UPDATE company_monthly_closures SET reason='Indevido' WHERE employee_id='ea2'").run()).rejects.toThrow();
      await expect(db.prepare("DELETE FROM company_monthly_closures WHERE employee_id='ea2'").run()).rejects.toThrow();
      expect((await closurePost({...closeBody,state:'open',expected_revision:1})).status).toBe(201);
      expect((await event({...holiday,work_date:'2026-09-03'})).status).toBe(201);
      const reopened=await (await closureGet()).json() as any;
      expect(reopened).toMatchObject({state:'open',revision:2});
      expect((await closurePost({...closeBody,expected_revision:2,expected_source_version:reopened.report.source_version})).status).toBe(201);
      const retained=await db.prepare("SELECT snapshot_hash FROM company_monthly_closures WHERE employee_id='ea2' AND revision=1").first<any>();
      expect(retained.snapshot_hash).toBe(closed.snapshot_hash);
      expect((await db.prepare("SELECT COUNT(*) n FROM company_monthly_closures WHERE employee_id='ea2'").first<any>()).n).toBe(3);
      env.DB={withSession:()=>({prepare:(sql:string)=>db.prepare(sql),async batch(statements:any[]){
        await db.prepare("UPDATE company_admins SET auth_version=1 WHERE id='aa'").run();
        return db.batch(statements);
      }})};
      expect((await call()).status).toBe(404);
      env.DB=binding;
      await db.prepare("UPDATE company_admins SET auth_version=0 WHERE id='aa'").run();
      await db.prepare("INSERT INTO monthly_closures(id,employee_id,month,status,version,snapshot_json,report_hash,closed_by,closed_at) VALUES('closure-b','eb','2026-10','open',1,'{}','secret-b','legacy-admin',?)").bind(now).run();
      expect((await call()).status).toBe(200);
      // Any unsupported old closure must block preview rather than be ignored.
      await db.prepare("INSERT INTO monthly_closures(id,employee_id,month,status,version,snapshot_json,report_hash,closed_by,closed_at) VALUES('closure-2','ea','2026-10','open',1,'{}','fixture','legacy-admin',?)").bind(now).run();
      await db.prepare("UPDATE monthly_closures SET status='closed' WHERE id='closure-2'").run();
      expect((await event({...holiday,expected_revision:2,value:{name:'Feriado bloqueado'}})).status).toBe(409);
      expect((await event({...occurrence,expected_revision:1,value:null})).status).toBe(409);
      const blocked=await call();expect(blocked.status).toBe(409);
      expect((await blocked.json() as any).error.code).toBe('company_report_reconciliation_required');
      env.ENABLE_COMPANY_SCHEDULES='false';expect((await call()).status).toBe(503);
    } finally {await mf.dispose();}
  },120000);
});
