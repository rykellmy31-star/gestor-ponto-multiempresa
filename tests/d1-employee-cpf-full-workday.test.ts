import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { employeeCpfAuthRoutes } from '../server/routes/employee-cpf-auth';
import { employeeCpfPunchRoutes } from '../server/routes/employee-cpf-punch';
import { employeeCpfHistoryRoutes } from '../server/routes/employee-cpf-history';
import { employeeCpfLookupKey } from '../server/core/employee-cpf';
import { hashPassword, sha256 } from '../server/core/crypto';

// Real Hono routes + SQLite-based local D1. No remote resources or real people.
// João works 07–16 Monday, with 11–12 lunch. The database verifies the four
// immutable punches, their order, session identity and replay idempotency.
const cpf='52998224725';
const pepper='cr-jornada-full-workday-auth-pepper-2026';
const lookupSecret='cr-jornada-full-workday-cpf-secret-2026';
const zone='America/Bahia';
const at=(hour:number,minute=0)=>Date.UTC(2026,9,26,hour+3,minute);
const types=['entry','break_start','break_end','exit'] as const;
const keys=[
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
];

describe('CR JORNADA — funcionário completa quatro pontos após login CPF',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('login inicial, troca de senha, quatro pontos, replay e histórico isolado',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(at(7));
    const mf=new Miniflare(convertV4MiniflareOptions({
      workers:[{name:'test',modules:true,
        script:'export default {fetch(){return new Response("ok")}}',
        d1Databases:['DB']}]
    }));
    try{
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession() as unknown as D1DatabaseSession;
      const shift=JSON.stringify({
        start:'07:00',break_start:'11:00',break_end:'12:00',
        end:'16:00',paid_break:false,weekdays:[1,2,3,4,5]
      });
      const rules=JSON.stringify({
        mark_tolerance:5,daily_tolerance:10,rounding_step:1,
        rounding_mode:'floor',auto_approve_overtime:false,
        compensation:'review',max_shift_hours:24
      });
      await db.batch([
        db.prepare('CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT,slug TEXT,timezone TEXT,status TEXT)'),
        db.prepare('CREATE TABLE employees(id TEXT PRIMARY KEY,company_id TEXT,full_name TEXT,status TEXT,admission_date TEXT,employment_end TEXT,deleted_at INTEGER)'),
        db.prepare('CREATE TABLE users(id TEXT PRIMARY KEY,employee_id TEXT,display_name TEXT,password_hash TEXT,role TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER,employee_temporary_password_expires_at INTEGER,updated_at INTEGER)'),
        db.prepare('CREATE TABLE employee_cpf_links(employee_id TEXT PRIMARY KEY,company_id TEXT,cpf_lookup_key TEXT)'),
        db.prepare('CREATE TABLE employee_company_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,employee_id TEXT,company_id TEXT,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE company_punch_policies(company_id TEXT PRIMARY KEY,enabled INTEGER,rules_json TEXT)'),
        db.prepare('CREATE TABLE schedules(id TEXT PRIMARY KEY,company_id TEXT,config_json TEXT)'),
        db.prepare('CREATE TABLE schedule_history(id TEXT PRIMARY KEY,schedule_id TEXT,effective_from TEXT,config_json TEXT)'),
        db.prepare('CREATE TABLE schedule_assignments(id TEXT PRIMARY KEY,employee_id TEXT,schedule_id TEXT,effective_from TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE schedule_assignment_cancellations(assignment_id TEXT PRIMARY KEY)'),
        db.prepare('CREATE TABLE work_days(id TEXT PRIMARY KEY,company_id TEXT,employee_id TEXT,work_date TEXT,timezone TEXT,schedule_json TEXT,rules_json TEXT,next_seq INTEGER NOT NULL DEFAULT 0,created_at INTEGER,last_at INTEGER,UNIQUE(employee_id,work_date))'),
        db.prepare('CREATE TABLE punches(id TEXT PRIMARY KEY,work_day_id TEXT NOT NULL,employee_id TEXT,seq INTEGER,type TEXT,recorded_at INTEGER,idempotency_key TEXT,ip_hash TEXT,receipt_hash TEXT,UNIQUE(work_day_id,seq),UNIQUE(employee_id,idempotency_key))'),
        db.prepare("CREATE TRIGGER punch_sequence BEFORE INSERT ON punches BEGIN SELECT CASE WHEN NEW.employee_id != (SELECT employee_id FROM work_days WHERE id=NEW.work_day_id) OR NEW.seq != (SELECT next_seq FROM work_days WHERE id=NEW.work_day_id) OR NEW.type != (CASE NEW.seq WHEN 0 THEN 'entry' WHEN 1 THEN 'break_start' WHEN 2 THEN 'break_end' ELSE 'exit' END) THEN RAISE(ABORT,'invalid_sequence') END; END"),
        db.prepare('CREATE TRIGGER punch_advance AFTER INSERT ON punches BEGIN UPDATE work_days SET next_seq=NEW.seq+1,last_at=NEW.recorded_at WHERE id=NEW.work_day_id; END'),
        db.prepare('CREATE TABLE company_admin_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER NOT NULL CHECK(affected_rows=1))'),
        db.prepare('CREATE TABLE company_employee_security_events(id TEXT PRIMARY KEY,company_id TEXT,employee_id TEXT,user_id TEXT,admin_id TEXT,action TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)'),
        db.prepare("INSERT INTO companies VALUES('co-a','Empresa A','empresa-a','America/Bahia','active'),('co-b','Empresa B','empresa-b','America/Bahia','active')"),
        db.prepare("INSERT INTO employees VALUES('joao','co-a','João Silva','active','2026-01-01',NULL,NULL),('maria','co-b','Maria Silva','active','2026-01-01',NULL,NULL)"),
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1,1,1,?,?)')
          .bind('user-joao','joao','João Silva',await hashPassword('SenhaProvisoriaA2026!',pepper),
            'employee',at(7)+24*3600000,at(7)),
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1,1,0,NULL,?)')
          .bind('user-maria','maria','Maria Silva',await hashPassword('SenhaEmpresaB2026!',pepper),
            'employee',at(7)),
        db.prepare('INSERT INTO employee_cpf_links VALUES (?,?,?),(?,?,?)')
          .bind('joao','co-a',employeeCpfLookupKey(cpf,lookupSecret),
            'maria','co-b',employeeCpfLookupKey(cpf,lookupSecret)),
        db.prepare('INSERT INTO company_punch_policies VALUES(?,1,?),(?,0,?)')
          .bind('co-a',rules,'co-b',rules),
        db.prepare('INSERT INTO schedules VALUES(?,?,?)').bind('schedule-a','co-a',shift),
        db.prepare('INSERT INTO schedule_assignments VALUES(?,?,?,?,?)')
          .bind('assignment-a','joao','schedule-a','2026-10-26',at(7))
      ]);

      const app=new Hono<App>();
      app.use('*',async(c,next)=>{c.set('db',db);await next();});
      app.route('/api/employee/cpf-auth',employeeCpfAuthRoutes);
      app.route('/api/employee/cpf-work',employeeCpfPunchRoutes);
      app.route('/api/employee/cpf-work',employeeCpfHistoryRoutes);
      app.onError((error,c)=>error instanceof ApiError
        ?c.json({error:{code:error.code,message:error.message}},error.status as any)
        :c.json({error:{code:'internal_error',message:String(error)}},500));
      const env={
        ENVIRONMENT:'development',AUTH_PEPPER:pepper,CPF_LOOKUP_SECRET:lookupSecret,
        ENABLE_EMPLOYEE_PUNCHES:'true',SESSION_HOURS:'12'
      } as any;
      const request=(path:string,body?:object,cookie?:string,csrf?:string)=>
        app.request(path,{
          method:body?'POST':'GET',
          headers:{
            ...(body?{'Content-Type':'application/json'}:{}),
            ...(cookie?{Cookie:cookie}:{}),
            ...(csrf?{'X-CSRF-Token':csrf}:{})
          },
          ...(body?{body:JSON.stringify(body)}:{})
        },env);
      const login=async(password:string)=>{
        const result=await request('/api/employee/cpf-auth/login',{cpf,password});
        const data=await result.json() as any;
        return {result,data,cookie:result.headers.get('set-cookie')?.split(';')[0]||''};
      };
      let auth=await login('SenhaProvisoriaA2026!');
      expect(auth.result.status).toBe(200);
      expect(auth.cookie).toContain('cr_jornada_employee_dev=');
      const initial=await request('/api/employee/cpf-auth/session',undefined,auth.cookie);
      expect(initial.status).toBe(200);
      const initialSession=await initial.json() as any;
      expect(initialSession.company.id).toBe('co-a');
      expect(initialSession.user.must_change_password).toBe(true);
      expect((await request('/api/employee/cpf-work/today',undefined,auth.cookie)).status).toBe(403);

      const passwordChange=await request('/api/employee/cpf-auth/password',{
        current_password:'SenhaProvisoriaA2026!',
        new_password:'NovaSenhaSeguraJoao2026!'
      },auth.cookie,initialSession.csrf_token);
      expect(passwordChange.status).toBe(200);
      expect((await passwordChange.json() as any).reauthentication_required).toBe(true);
      expect((await request('/api/employee/cpf-auth/session',undefined,auth.cookie)).status).toBe(401);
      expect((await login('SenhaProvisoriaA2026!')).result.status).toBe(401);

      auth=await login('NovaSenhaSeguraJoao2026!');
      expect(auth.result.status).toBe(200);
      expect(auth.data.selection_required).toBe(false);
      const active=await request('/api/employee/cpf-auth/session',undefined,auth.cookie);
      expect(active.status).toBe(200);
      const activeSession=await active.json() as any;
      expect(activeSession.user.must_change_password).toBe(false);
      expect(activeSession.company.id).toBe('co-a');
      let csrf=activeSession.csrf_token;
      const url='/api/employee/cpf-work';
      const times=[at(7),at(11),at(12),at(16)];
      const receipts:string[]=[];
      let reauthentications=0;
      for(let i=0;i<types.length;i++){
        vi.mocked(Date.now).mockReturnValue(times[i]);
        let before=await request(url+'/today',undefined,auth.cookie);
        if(before.status===401){
          // A sessão é intencionalmente limitada a 60 minutos sem uso.
          // Não afrouxar essa proteção só porque a jornada dura oito horas:
          // simular o login normal do funcionário antes da próxima batida.
          reauthentications++;
          auth=await login('NovaSenhaSeguraJoao2026!');
          expect(auth.result.status).toBe(200);
          expect(auth.data.selection_required).toBe(false);
          const renewed=await request('/api/employee/cpf-auth/session',undefined,auth.cookie);
          expect(renewed.status).toBe(200);
          const renewedData=await renewed.json() as any;
          expect(renewedData.company.id).toBe('co-a');
          csrf=renewedData.csrf_token;
          before=await request(url+'/today',undefined,auth.cookie);
        }
        expect(before.status).toBe(200);
        expect(await before.json()).toMatchObject({
          company_id:'co-a',employee_id:'joao',
          work_date:'2026-10-26',next_seq:i,next_type:types[i]
        });
        const confirmed=await request(url+'/punch',{
          type:types[i],idempotency_key:keys[i]
        },auth.cookie,csrf);
        const data=await confirmed.json() as any;
        expect(confirmed.status,
          'Nova batida '+(i+1)+' '+types[i]+' (chave '+keys[i]+') retornou '+
          JSON.stringify(data)
        ).toBe(201);
        expect(data.replayed).toBe(false);
        expect(data.punch.type).toBe(types[i]);
        expect(data.punch.recorded_at).toBe(times[i]);
        receipts.push(data.punch.receipt_hash);
        const retry=await request(url+'/punch',{
          type:types[i],idempotency_key:keys[i]
        },auth.cookie,csrf);
        expect(retry.status).toBe(200);
        expect((await retry.json() as any).replayed).toBe(true);
      }
      expect(reauthentications).toBeGreaterThanOrEqual(2);
      const finished=await request(url+'/today',undefined,auth.cookie);
      expect(finished.status).toBe(200);
      expect(await finished.json()).toMatchObject({next_seq:4,next_type:null,completed:true});
      const stamps=await db.prepare('SELECT seq,type,recorded_at,receipt_hash FROM punches ORDER BY seq').all<any>();
      expect(stamps.results?.map(p=>[p.seq,p.type,p.recorded_at])).toEqual([
        [0,'entry',times[0]],[1,'break_start',times[1]],
        [2,'break_end',times[2]],[3,'exit',times[3]]
      ]);
      expect(stamps.results?.map(p=>p.receipt_hash)).toEqual(receipts);
      expect(new Set(receipts).size).toBe(4);
      const day=await db.prepare('SELECT company_id,employee_id,work_date,next_seq FROM work_days').first<any>();
      expect(day).toEqual({company_id:'co-a',employee_id:'joao',work_date:'2026-10-26',next_seq:4});
      const history=await request(url+'/history?month=2026-10&company_id=co-b',undefined,auth.cookie);
      expect(history.status).toBe(200);
      const historyData=await history.json() as any;
      expect(historyData.company_id).toBe('co-a');
      expect(historyData.employee_id).toBe('joao');
      expect(historyData.days[0].punches).toHaveLength(4);
      const afterEnd=await request(url+'/punch',{
        type:'entry',idempotency_key:'55555555-5555-4555-8555-555555555555'
      },auth.cookie,csrf);
      expect(afterEnd.status).toBe(409);
      expect((await db.prepare('SELECT COUNT(*) AS count FROM punches')
        .first<{count:number}>())?.count).toBe(4);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
    }finally{
      await mf.dispose();
    }
  },120000);
});
