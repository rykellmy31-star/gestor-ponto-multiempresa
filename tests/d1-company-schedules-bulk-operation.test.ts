import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { sha256 } from '../server/core/crypto';
import { companySchedulesRoutes } from '../server/routes/company-schedules';

// Real local SQLite/D1, real Hono tenant middleware, synthetic identities.
// No live database, credentials, real CPF or remote Cloudflare connections.
describe('CR JORNADA — gestor aplica jornada para todos no D1 local',()=>{
  it('duas empresas, dois turnos consecutivos, repetição e conflito sem gravação parcial',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({
      workers:[{
        name:'test',modules:true,
        script:'export default {fetch(){return new Response("ok")}}',
        d1Databases:['DB']
      }]
    }));
    try{
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession() as unknown as D1DatabaseSession;
      const now=Date.now();
      const morning=JSON.stringify({start:'07:00',break_start:'11:00',
        break_end:'12:00',end:'16:00',paid_break:false,weekdays:[1,2,3,4,5]});
      const afternoon=JSON.stringify({start:'13:00',break_start:'16:00',
        break_end:'17:00',end:'22:00',paid_break:false,weekdays:[1,2,3,4,5]});
      await db.batch([
        db.prepare('CREATE TABLE companies(id TEXT PRIMARY KEY,slug TEXT,status TEXT NOT NULL)'),
        db.prepare('CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,display_name TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER)'),
        db.prepare('CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,company_id TEXT,csrf_token TEXT,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE employees(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,full_name TEXT,status TEXT,deleted_at INTEGER)'),
        db.prepare('CREATE TABLE company_workspace_audit(id TEXT PRIMARY KEY,company_id TEXT,target_id TEXT,action TEXT)'),
        db.prepare('CREATE TABLE schedules(id TEXT PRIMARY KEY,company_id TEXT,name TEXT,config_json TEXT,deleted_at INTEGER)'),
        db.prepare('CREATE TABLE schedule_history(id TEXT PRIMARY KEY,schedule_id TEXT,effective_from TEXT,config_json TEXT)'),
        db.prepare('CREATE TABLE schedule_assignments(id TEXT PRIMARY KEY,employee_id TEXT,schedule_id TEXT,effective_from TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE schedule_assignment_cancellations(assignment_id TEXT PRIMARY KEY)'),
        db.prepare('CREATE TABLE company_schedule_audit(id TEXT PRIMARY KEY,company_id TEXT,admin_id TEXT,action TEXT,schedule_id TEXT,employee_id TEXT,details_json TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE company_employee_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER NOT NULL CHECK(affected_rows=1))'),
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)'),
        db.prepare("INSERT INTO companies VALUES('co-a','empresa-a','active'),('co-b','empresa-b','active')"),
        db.prepare("INSERT INTO company_admins VALUES('admin-a','co-a','gestor-a','Gestor A',1,1,0,NULL),('admin-b','co-b','gestor-b','Gestor B',1,1,0,NULL)"),
        db.prepare('INSERT INTO company_admin_sessions VALUES(?,?,?,?,?,?,1)')
          .bind(sha256('a'.repeat(64)),'admin-a','co-a','csrf-a',now+600000,now),
        db.prepare('INSERT INTO company_admin_sessions VALUES(?,?,?,?,?,?,1)')
          .bind(sha256('b'.repeat(64)),'admin-b','co-b','csrf-b',now+600000,now),
        db.prepare("INSERT INTO employees VALUES('joao','co-a','João','active',NULL),('maria','co-a','Maria','active',NULL),('blocked','co-a','Bloqueado','blocked',NULL),('other','co-b','Outra empresa','active',NULL)"),
        db.prepare('INSERT INTO schedules VALUES(?,?,?,?,NULL)')
          .bind('morning-a','co-a','Manhã',morning),
        db.prepare('INSERT INTO schedules VALUES(?,?,?,?,NULL)')
          .bind('afternoon-a','co-a','Tarde',afternoon),
        db.prepare('INSERT INTO schedules VALUES(?,?,?,?,NULL)')
          .bind('morning-b','co-b','Manhã B',morning)
      ]);

      const app=new Hono<App>();
      app.use('*',async(c,next)=>{c.set('db',db);await next()});
      app.route('/api/company/schedules',companySchedulesRoutes);
      app.onError((e,c)=>e instanceof ApiError
        ?c.json({error:{code:e.code,message:e.message}},e.status as any)
        :c.json({error:{code:'internal_error',message:String(e)}},500));
      const env={ENVIRONMENT:'development',ENABLE_COMPANY_SCHEDULES:'true',
        AUTH_PEPPER:'test-bulk-schedule-pepper-2026-very-long'} as any;
      const request=(path:string,company:'a'|'b',body?:object)=>{
        const token=company==='a'?'a'.repeat(64):'b'.repeat(64);
        const csrf=company==='a'?'csrf-a':'csrf-b';
        return app.request('/api/company/schedules'+path,{
          method:body?'POST':'GET',
          headers:{
            Cookie:'cr_jornada_company_dev='+token,
            'X-CSRF-Token':csrf,
            ...(body?{'Content-Type':'application/json'}:{})
          },...(body?{body:JSON.stringify(body)}:{})
        },env);
      };

      const bulk=await request('/morning-a/assign-all','a',{effective_from:'2026-10-26'});
      expect(bulk.status).toBe(201);
      expect(await bulk.json()).toMatchObject({
        company_id:'co-a',assigned_count:2,reused_count:0
      });
      const first=await db.prepare(
        "SELECT a.employee_id,a.schedule_id,a.effective_from FROM schedule_assignments a ORDER BY a.employee_id"
      ).all<any>();
      expect(first.results).toEqual([
        {employee_id:'joao',schedule_id:'morning-a',effective_from:'2026-10-26'},
        {employee_id:'maria',schedule_id:'morning-a',effective_from:'2026-10-26'}
      ]);
      const repeat=await request('/morning-a/assign-all','a',{effective_from:'2026-10-26'});
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toMatchObject({
        assigned_count:0,reused_count:2,reused:true
      });

      // João works 07:00 on Monday; the manager changes just João to
      // 13:00 from Tuesday, keeping Maria and old work dates untouched.
      const individual=await request('/afternoon-a/assign','a',{
        employee_id:'joao',effective_from:'2026-10-27'
      });
      expect(individual.status).toBe(201);
      const preview=await request('/employee/joao/week?from=2026-10-26','a');
      expect(preview.status).toBe(200);
      const week=await preview.json() as any;
      expect(week.days[0].shift.start).toBe('07:00');
      expect(week.days[1].shift.start).toBe('13:00');
      const mariaPreview=await request('/employee/maria/week?from=2026-10-26','a');
      expect(mariaPreview.status).toBe(200);
      expect((await mariaPreview.json() as any).days[1].shift.start).toBe('07:00');

      // There is an active assignment on Tuesday for João already:
      // applying morning to all on Tuesday must not alter Maria alone.
      const conflict=await request('/morning-a/assign-all','a',{
        effective_from:'2026-10-27'
      });
      expect(conflict.status).toBe(409);
      expect((await conflict.json() as any).error.code).toBe('schedule_date_conflict');
      const check=await db.prepare(
        "SELECT employee_id,schedule_id,effective_from FROM schedule_assignments ORDER BY employee_id,effective_from"
      ).all<any>();
      expect(check.results).toEqual([
        {employee_id:'joao',schedule_id:'morning-a',effective_from:'2026-10-26'},
        {employee_id:'joao',schedule_id:'afternoon-a',effective_from:'2026-10-27'},
        {employee_id:'maria',schedule_id:'morning-a',effective_from:'2026-10-26'}
      ]);
      expect((await request('/morning-a/assign-all','b',{
        effective_from:'2026-10-28'
      })).status).toBe(404);
      expect((await request('/employee/joao/week?from=2026-10-26','b')).status).toBe(404);
      const companyB=await request('/morning-b/assign-all','b',{
        effective_from:'2026-10-26'
      });
      expect(companyB.status).toBe(201);
      expect(await companyB.json()).toMatchObject({
        company_id:'co-b',assigned_count:1
      });
      const audit=await db.prepare('SELECT company_id,COUNT(*) AS total FROM company_schedule_audit GROUP BY company_id ORDER BY company_id').all<any>();
      expect(audit.results).toEqual([
        {company_id:'co-a',total:3},{company_id:'co-b',total:1}
      ]);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM company_employee_write_guards')
        .first<{total:number}>())?.total).toBe(0);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
    }finally{
      await mf.dispose();
    }
  },120000);
});
