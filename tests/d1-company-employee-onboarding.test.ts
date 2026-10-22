import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companyEmployeesRoutes } from '../server/routes/company-employees';
import { companySchedulesRoutes } from '../server/routes/company-schedules';
import { employeeCpfAuthRoutes } from '../server/routes/employee-cpf-auth';
import { employeeCpfPunchRoutes } from '../server/routes/employee-cpf-punch';
import { employeeCpfHistoryRoutes } from '../server/routes/employee-cpf-history';
import { employeeCpfLookupKey } from '../server/core/employee-cpf';
import { hashPassword, sha256, verifyPassword } from '../server/core/crypto';

const pepper='cr-jornada-onboarding-pepper-test-2026';
const cpfSecret='cr-jornada-onboarding-cpf-secret-2026';
const dataKey='a'.repeat(64);
const tokenA='a'.repeat(64);
const tokenB='b'.repeat(64);
const cpf='52998224725';
const at=(hour:number,minute=0)=>Date.UTC(2026,9,26,hour+3,minute);

const payload=(name:string,registration='001',cpfValue=cpf)=>({
  full_name:name,registration,cpf:cpfValue,
  job_title:'Atendente',admission_date:'2026-10-21'
});

describe('CR JORNADA — cadastro empresarial D1 local de ponta a ponta',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('duas empresas criam funcionários, isolam CPF/matrícula e protegem acessos',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(at(7));
    const mf=new Miniflare(convertV4MiniflareOptions({
      workers:[{name:'test',modules:true,
        script:'export default { fetch() { return new Response("ok") } }',
        d1Databases:['DB']}]
    }));
    try{
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession() as unknown as D1DatabaseSession;
      const rules=JSON.stringify({
        mark_tolerance:5,daily_tolerance:10,rounding_step:1,
        rounding_mode:'floor',auto_approve_overtime:false,
        compensation:'review',max_shift_hours:24
      });
      await db.batch([
        db.prepare("CREATE TABLE companies(id TEXT PRIMARY KEY,slug TEXT,status TEXT NOT NULL,name TEXT,timezone TEXT)"),
        db.prepare("CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,display_name TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER)"),
        db.prepare("CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,company_id TEXT,csrf_token TEXT,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)"),
        db.prepare("CREATE TABLE employees(id TEXT PRIMARY KEY,full_name TEXT,registration TEXT UNIQUE,company_registration TEXT,cpf_encrypted TEXT,cpf_last4 TEXT,job_title TEXT,admission_date TEXT,employment_end TEXT,status TEXT,notes TEXT,created_at INTEGER,updated_at INTEGER,company_id TEXT,deleted_at INTEGER,UNIQUE(company_id,company_registration))"),
        db.prepare("CREATE TABLE users(id TEXT PRIMARY KEY,login TEXT UNIQUE,email TEXT,display_name TEXT,password_hash TEXT,role TEXT,employee_id TEXT,active INTEGER,must_change_password INTEGER,employee_temporary_password_expires_at INTEGER,created_at INTEGER,updated_at INTEGER,auth_version INTEGER NOT NULL DEFAULT 1)"),
        db.prepare("CREATE TABLE employee_cpf_links(employee_id TEXT PRIMARY KEY,company_id TEXT,cpf_lookup_key TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(company_id,cpf_lookup_key))"),
        db.prepare("CREATE TABLE company_employee_registration_audit(id TEXT PRIMARY KEY,company_id TEXT,employee_id TEXT,admin_id TEXT,action TEXT,created_at INTEGER)"),
        db.prepare("CREATE TABLE company_employee_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER NOT NULL CHECK(affected_rows=1))"),
        db.prepare('CREATE TABLE schedules(id TEXT PRIMARY KEY,name TEXT,config_json TEXT,created_by TEXT,created_at INTEGER,company_id TEXT,deleted_at INTEGER)'),
        // Triggers presentes no schema real: D1.meta.changes inclui tambem
        // estas atualizacoes, embora cada INSERT principal grave uma linha.
        db.prepare('CREATE TABLE data_revision(id INTEGER PRIMARY KEY,value INTEGER NOT NULL)'),
        db.prepare('CREATE TABLE audit_log(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,details_json TEXT,ip_hash TEXT,created_at INTEGER)'),
        db.prepare('CREATE TRIGGER revision_employees_update AFTER UPDATE ON employees BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END'),
        db.prepare('INSERT INTO data_revision VALUES(1,0)'),
        db.prepare('CREATE TRIGGER revision_schedules_insert AFTER INSERT ON schedules BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END'),
        db.prepare('CREATE TABLE schedule_history(id TEXT PRIMARY KEY,schedule_id TEXT,effective_from TEXT,config_json TEXT)'),
        db.prepare('CREATE TABLE schedule_assignments(id TEXT PRIMARY KEY,employee_id TEXT,schedule_id TEXT,effective_from TEXT,created_at INTEGER)'),
        db.prepare('CREATE TRIGGER revision_schedule_assignments_insert AFTER INSERT ON schedule_assignments BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END'),
        db.prepare('CREATE TABLE schedule_assignment_cancellations(assignment_id TEXT PRIMARY KEY)'),
        db.prepare('CREATE TABLE company_schedule_audit(id TEXT PRIMARY KEY,company_id TEXT,admin_id TEXT,action TEXT,schedule_id TEXT,employee_id TEXT,details_json TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE company_schedule_create_requests(company_id TEXT,admin_id TEXT,request_key TEXT,request_fingerprint TEXT,schedule_id TEXT,created_at INTEGER,PRIMARY KEY(company_id,admin_id,request_key))'),
        db.prepare('CREATE TABLE employee_company_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,employee_id TEXT,company_id TEXT,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE company_punch_policies(company_id TEXT PRIMARY KEY,enabled INTEGER,rules_json TEXT)'),
        db.prepare('CREATE TABLE work_days(id TEXT PRIMARY KEY,employee_id TEXT,work_date TEXT,timezone TEXT,schedule_json TEXT,rules_json TEXT,next_seq INTEGER NOT NULL DEFAULT 0,created_at INTEGER,last_at INTEGER,company_id TEXT,UNIQUE(employee_id,work_date))'),
        db.prepare('CREATE TABLE punches(id TEXT PRIMARY KEY,work_day_id TEXT NOT NULL,employee_id TEXT,seq INTEGER,type TEXT,recorded_at INTEGER,idempotency_key TEXT,ip_hash TEXT,receipt_hash TEXT,UNIQUE(work_day_id,seq),UNIQUE(employee_id,idempotency_key))'),
        db.prepare("CREATE TRIGGER punch_sequence BEFORE INSERT ON punches BEGIN SELECT CASE WHEN NEW.employee_id != (SELECT employee_id FROM work_days WHERE id=NEW.work_day_id) OR NEW.seq != (SELECT next_seq FROM work_days WHERE id=NEW.work_day_id) OR NEW.type != (CASE NEW.seq WHEN 0 THEN 'entry' WHEN 1 THEN 'break_start' WHEN 2 THEN 'break_end' ELSE 'exit' END) THEN RAISE(ABORT,'invalid_sequence') END; END"),
        db.prepare('CREATE TRIGGER punch_advance AFTER INSERT ON punches BEGIN UPDATE work_days SET next_seq=NEW.seq+1,last_at=NEW.recorded_at WHERE id=NEW.work_day_id; END'),
        db.prepare('CREATE TABLE company_admin_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER NOT NULL CHECK(affected_rows=1))'),
        db.prepare('CREATE TABLE company_employee_security_events(id TEXT PRIMARY KEY,company_id TEXT,employee_id TEXT,user_id TEXT,admin_id TEXT,action TEXT,created_at INTEGER)'),
        db.prepare("CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)"),
        db.prepare("INSERT INTO companies VALUES ('co-a','empresa-a','active','Empresa A','America/Bahia'),('co-b','empresa-b','active','Empresa B','America/Bahia')"),
        db.prepare("INSERT INTO company_admins VALUES('admin-a','co-a','gestor-a','Gestor A',1,1,0,NULL),('admin-b','co-b','gestor-b','Gestor B',1,1,0,NULL)"),
        db.prepare("INSERT INTO company_admin_sessions VALUES (?,?,?,?,?,?,1)")
          .bind(sha256(tokenA),'admin-a','co-a','csrf-a',Date.now()+600000,Date.now()),
        db.prepare("INSERT INTO company_admin_sessions VALUES (?,?,?,?,?,?,1)")
          .bind(sha256(tokenB),'admin-b','co-b','csrf-b',Date.now()+600000,Date.now()),
        db.prepare('INSERT INTO company_punch_policies VALUES (?,1,?),(?,0,?)')
          .bind('co-a',rules,'co-b',rules)
      ]);
      const app=new Hono<App>();
      app.use('*',async(c,next)=>{c.set('db',db);await next();});
      app.route('/api/company/employees',companyEmployeesRoutes);
      app.route('/api/company/schedules',companySchedulesRoutes);
      app.route('/api/employee/cpf-auth',employeeCpfAuthRoutes);
      app.route('/api/employee/cpf-work',employeeCpfPunchRoutes);
      app.route('/api/employee/cpf-work',employeeCpfHistoryRoutes);
      app.onError((e,c)=>e instanceof ApiError
        ?c.json({error:{code:e.code,message:e.message}},e.status as any)
        :c.json({error:{code:'internal_error',message:String(e)}},500));
      const env={
        ENVIRONMENT:'development' as const,
        ENABLE_COMPANY_EMPLOYEE_REGISTRATION:'true',
        ENABLE_COMPANY_SCHEDULES:'true',
        ENABLE_EMPLOYEE_PUNCHES:'true',SESSION_HOURS:'12',
        AUTH_PEPPER:pepper,CPF_LOOKUP_SECRET:cpfSecret,DATA_KEY:dataKey
      } as App['Bindings'];
      const post=(token:string,csrf:string,body:object)=>
        app.request('/api/company/employees',{
          method:'POST',headers:{
            Cookie:'cr_jornada_company_dev='+token,
            'X-CSRF-Token':csrf,'Content-Type':'application/json'
          },body:JSON.stringify(body)
        },env);
      const get=(token:string)=>app.request('/api/company/employees',{
        headers:{Cookie:'cr_jornada_company_dev='+token}
      },env);

      // Two administrators use the same visible registration; the global
      // legacy technical registration is automatically generated as unique.
      const responseA=await post(tokenA,'csrf-a',payload('João da Empresa A'));
      expect(responseA.status).toBe(201);
      const a=await responseA.json() as any;
      expect(a.company_id).toBe('co-a');
      expect(a.employee.registration).toBe('001');
      expect(a.must_change_password).toBe(true);
      expect(a.temporary_password).toMatch(/^[a-f0-9]{24}$/);
      expect(responseA.headers.get('Cache-Control')).toContain('no-store');
      expect(JSON.stringify(a)).not.toContain(cpf);

      const responseB=await post(tokenB,'csrf-b',payload('Maria da Empresa B'));
      expect(responseB.status).toBe(201);
      const b=await responseB.json() as any;
      expect(b.company_id).toBe('co-b');
      expect(b.employee.registration).toBe('001');
      expect(b.employee.id).not.toBe(a.employee.id);
      expect(a.temporary_password).not.toBe(b.temporary_password);

      const patchProfile=(id:string,body:object,token=tokenA,csrf='csrf-a')=>app.request('/api/company/employees/'+id,{
        method:'PATCH',headers:{Cookie:'cr_jornada_company_dev='+token,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
        body:JSON.stringify(body)
      },env);
      const original=(await (await get(tokenA)).json() as any).employees[0];
      const edited={full_name:'João Atualizado',job_title:'Supervisor',expected_updated_at:original.updated_at};
      expect((await patchProfile(b.employee.id,edited)).status).toBe(404);
      expect((await patchProfile(a.employee.id,edited,tokenA,'wrong')).status).toBe(403);
      expect((await patchProfile(a.employee.id,{...edited,company_id:'co-b'})).status).toBe(400);
      expect((await patchProfile(a.employee.id,edited)).status).toBe(200);
      expect((await patchProfile(a.employee.id,edited)).status).toBe(409);
      expect((await db.prepare('SELECT display_name FROM users WHERE employee_id=?').bind(a.employee.id).first<any>())?.display_name).toBe('João Atualizado');
      expect((await db.prepare('SELECT full_name FROM employees WHERE id=?').bind(b.employee.id).first<any>())?.full_name).toBe('Maria da Empresa B');
      const profileAudit=await db.prepare("SELECT details_json FROM audit_log WHERE action='company.employee.profile_updated'").all<any>();
      expect(profileAudit.results).toHaveLength(1);
      expect(JSON.parse(profileAudit.results[0].details_json)).toMatchObject({company_id:'co-a',admin_id:'admin-a',before:{full_name:'João da Empresa A'},after:{full_name:'João Atualizado'}});
      await db.prepare("CREATE TRIGGER reject_profile_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END").run();
      const current=(await (await get(tokenA)).json() as any).employees[0];
      expect((await patchProfile(a.employee.id,{...edited,full_name:'Não deve salvar',expected_updated_at:current.updated_at})).status).toBe(500);
      expect((await db.prepare('SELECT full_name FROM employees WHERE id=?').bind(a.employee.id).first<any>())?.full_name).toBe('João Atualizado');
      await db.prepare('DROP TRIGGER reject_profile_audit').run();

      const dbEmployees=await db.prepare(
        'SELECT id,company_id,registration,company_registration,cpf_encrypted,cpf_last4 FROM employees ORDER BY company_id'
      ).all<any>();
      expect(dbEmployees.results).toHaveLength(2);
      for(const row of dbEmployees.results){
        expect(row.registration).toMatch(/^emp-[0-9a-f-]{36}$/);
        expect(row.company_registration).toBe('001');
        expect(row.cpf_encrypted).toMatch(/^v1\./);
        expect(row.cpf_encrypted).not.toContain(cpf);
        expect(row.cpf_last4).toBe('4725');
      }
      expect(dbEmployees.results?.[0].registration)
        .not.toBe(dbEmployees.results?.[1].registration);
      const links=await db.prepare('SELECT company_id,cpf_lookup_key FROM employee_cpf_links ORDER BY company_id').all<any>();
      expect(links.results).toEqual([
        {company_id:'co-a',cpf_lookup_key:employeeCpfLookupKey(cpf,cpfSecret)},
        {company_id:'co-b',cpf_lookup_key:employeeCpfLookupKey(cpf,cpfSecret)}
      ]);
      const userA=await db.prepare('SELECT password_hash,must_change_password,employee_temporary_password_expires_at FROM users WHERE employee_id=?')
        .bind(a.employee.id).first<any>();
      expect(userA?.must_change_password).toBe(1);
      expect(userA?.employee_temporary_password_expires_at).toBeGreaterThan(Date.now());
      expect(await verifyPassword(a.temporary_password,userA!.password_hash,pepper)).toBe(true);

      const listedA=await (await get(tokenA)).json() as any;
      const listedB=await (await get(tokenB)).json() as any;
      expect(listedA.employees.map((e:any)=>e.id)).toEqual([a.employee.id]);
      expect(listedB.employees.map((e:any)=>e.id)).toEqual([b.employee.id]);

      const duplicateCpf=await post(tokenA,'csrf-a',payload('Outro João','002'));
      expect(duplicateCpf.status).toBe(409);
      const duplicateMatricula=await post(tokenA,'csrf-a',payload('Outro João','001','11144477735'));
      expect(duplicateMatricula.status).toBe(409);
      const crossTenant=await post(tokenA,'csrf-a',{...payload('João Invasor','003'),company_id:'co-b'});
      expect(crossTenant.status).toBe(400);
      const wrongCsrf=await post(tokenA,'csrf-b',payload('João CSRF','004'));
      expect(wrongCsrf.status).toBe(403);
      // Integração completa: os funcionários criados acima são os IDs usados
      // pelas jornadas. Não inserir funcionários fictícios diretamente na
      // tabela de escalas: simular o gestor operando as duas telas.
      const third=await post(tokenA,'csrf-a',
        payload('Ana da Empresa A','002','11144477735'));
      expect(third.status).toBe(201);
      const ana=await third.json() as any;
      expect(ana.employee.id).not.toBe(a.employee.id);
      const morning={
        name:'Jornada Manhã',start:'07:00',break_start:'11:00',
        break_end:'12:00',end:'16:00',paid_break:false,
        weekdays:[1,2,3,4,5]
      };
      const afternoon={
        ...morning,name:'Jornada Tarde',start:'13:00',
        break_start:'16:00',break_end:'17:00',end:'22:00',
        // Mesmo modelo: terça é à tarde, quarta tem horário especial
        // das 7h. Quinta volta à jornada padrão de 13h.
        day_overrides:{
          '3':{start:'07:00',break_start:'11:00',
            break_end:'12:00',end:'16:00',paid_break:false}
        }
      };
      const schedulePost=(token:string,csrf:string,path:string,data:object)=>
        app.request('/api/company/schedules'+(path==='/'?'':path),{
          method:'POST',headers:{
            Cookie:'cr_jornada_company_dev='+token,
            'X-CSRF-Token':csrf,'Content-Type':'application/json'
          },body:JSON.stringify(data)
        },env);
      const scheduleGet=(token:string,path:string)=>
        app.request('/api/company/schedules'+(path==='/'?'':path),{
          headers:{Cookie:'cr_jornada_company_dev='+token}
        },env);
      const morningA=await schedulePost(tokenA,'csrf-a','/',morning);
      expect(morningA.status).toBe(201);
      const scheduleA=(await morningA.json() as any).id as string;
      // Horário especial em dia não selecionado precisa ser rejeitado
      // antes de criar jornada ou gravar auditoria.
      const invalidOverride=await schedulePost(tokenA,'csrf-a','/',{
        ...morning,day_overrides:{
          '0':{start:'08:00',break_start:'12:00',
            break_end:'13:00',end:'17:00',paid_break:false}
        }
      });
      expect(invalidOverride.status).toBe(422);
      expect((await invalidOverride.json() as any).error.code)
        .toBe('invalid_schedule');
      const afternoonA=await schedulePost(tokenA,'csrf-a','/',afternoon);
      expect(afternoonA.status).toBe(201);
      const scheduleAfternoon=(await afternoonA.json() as any).id as string;
      const morningB=await schedulePost(tokenB,'csrf-b','/',morning);
      expect(morningB.status).toBe(201);
      const scheduleB=(await morningB.json() as any).id as string;
      const assignAllA=await schedulePost(
        tokenA,'csrf-a','/'+scheduleA+'/assign-all',
        {effective_from:'2026-10-26'}
      );
      expect(assignAllA.status).toBe(201);
      expect(await assignAllA.json()).toMatchObject({
        company_id:'co-a',assigned_count:2,reused_count:0
      });
      const repeated=await schedulePost(
        tokenA,'csrf-a','/'+scheduleA+'/assign-all',
        {effective_from:'2026-10-26'}
      );
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toMatchObject({
        assigned_count:0,reused_count:2,reused:true
      });
      const assignAllB=await schedulePost(
        tokenB,'csrf-b','/'+scheduleB+'/assign-all',
        {effective_from:'2026-10-26'}
      );
      expect(assignAllB.status).toBe(201);
      expect(await assignAllB.json()).toMatchObject({
        company_id:'co-b',assigned_count:1
      });
      // João muda para 13h terça-feira; Ana mantém 7h em A;
      // Maria mantém 7h em B. O dia anterior continua preservado.
      const newShift=await schedulePost(
        tokenA,'csrf-a','/'+scheduleAfternoon+'/assign',
        {employee_id:a.employee.id,effective_from:'2026-10-27'}
      );
      expect(newShift.status).toBe(201);
      const joaoWeek=await scheduleGet(tokenA,
        '/employee/'+a.employee.id+'/week?from=2026-10-26');
      const anaWeek=await scheduleGet(tokenA,
        '/employee/'+ana.employee.id+'/week?from=2026-10-26');
      const mariaWeek=await scheduleGet(tokenB,
        '/employee/'+b.employee.id+'/week?from=2026-10-26');
      expect(joaoWeek.status).toBe(200);
      expect(anaWeek.status).toBe(200);
      expect(mariaWeek.status).toBe(200);
      const joaoDays=(await joaoWeek.json() as any).days;
      const anaDays=(await anaWeek.json() as any).days;
      const mariaDays=(await mariaWeek.json() as any).days;
      expect(joaoDays[0].shift.start).toBe('07:00');
      expect(joaoDays[1].shift.start).toBe('13:00');
      expect(joaoDays[2].shift.start).toBe('07:00');
      expect(joaoDays[2].shift.end).toBe('16:00');
      expect(joaoDays[3].shift.start).toBe('13:00');
      expect(anaDays[0].shift.start).toBe('07:00');
      expect(anaDays[1].shift.start).toBe('07:00');
      expect(anaDays[2].shift.start).toBe('07:00');
      expect(mariaDays[1].shift.start).toBe('07:00');
      expect(mariaDays[2].shift.start).toBe('07:00');
      expect((await scheduleGet(tokenB,
        '/employee/'+a.employee.id+'/week?from=2026-10-26')).status)
        .toBe(404);
      expect((await scheduleGet(tokenA,
        '/employee/'+b.employee.id+'/week?from=2026-10-26')).status)
        .toBe(404);
      expect((await schedulePost(tokenB,'csrf-b',
        '/'+scheduleA+'/assign-all',
        {effective_from:'2026-10-28'})).status).toBe(404);
      const conflicting=await schedulePost(
        tokenA,'csrf-a','/'+scheduleA+'/assign-all',
        {effective_from:'2026-10-27'}
      );
      expect(conflicting.status).toBe(409);
      expect((await conflicting.json() as any).error.code)
        .toBe('schedule_date_conflict');
      const assignments=await db.prepare(
        'SELECT employee_id,schedule_id,effective_from FROM schedule_assignments'
      ).all<any>();
      expect(assignments.results).toHaveLength(4);
      expect(assignments.results).toEqual(expect.arrayContaining([
        {employee_id:a.employee.id,schedule_id:scheduleA,
          effective_from:'2026-10-26'},
        {employee_id:a.employee.id,schedule_id:scheduleAfternoon,
          effective_from:'2026-10-27'},
        {employee_id:ana.employee.id,schedule_id:scheduleA,
          effective_from:'2026-10-26'},
        {employee_id:b.employee.id,schedule_id:scheduleB,
          effective_from:'2026-10-26'}
      ]));
      const auditSchedules=await db.prepare(
        'SELECT company_id,action,COUNT(*) AS total FROM company_schedule_audit '+
        'GROUP BY company_id,action ORDER BY company_id,action'
      ).all<any>();
      expect(auditSchedules.results).toEqual([
        {company_id:'co-a',action:'assigned',total:3},
        {company_id:'co-a',action:'created',total:2},
        {company_id:'co-b',action:'assigned',total:1},
        {company_id:'co-b',action:'created',total:1}
      ]);
      await db.prepare("UPDATE company_admins SET active=0 WHERE id='admin-b'").run();
      const suspended=await post(tokenB,'csrf-b',payload('Suspensa','005'));
      expect(suspended.status).toBe(401);
      expect((await schedulePost(tokenB,'csrf-b',
        '/'+scheduleB+'/assign-all',
        {effective_from:'2026-10-28'})).status).toBe(401);
      const counts=await db.prepare('SELECT company_id,COUNT(*) AS total FROM employees GROUP BY company_id ORDER BY company_id').all<any>();
      expect(counts.results).toEqual([
        {company_id:'co-a',total:2},{company_id:'co-b',total:1}
      ]);
      const audit=await db.prepare('SELECT company_id,employee_id,admin_id,action FROM company_employee_registration_audit ORDER BY company_id').all<any>();
      expect(audit.results).toHaveLength(3);
      expect(audit.results).toEqual(expect.arrayContaining([
        {company_id:'co-a',employee_id:a.employee.id,admin_id:'admin-a',action:'created'},
        {company_id:'co-a',employee_id:ana.employee.id,admin_id:'admin-a',action:'created'},
        {company_id:'co-b',employee_id:b.employee.id,admin_id:'admin-b',action:'created'}
      ]));

      // Ana acaba de ser cadastrada pelo gestor e recebeu a jornada
      // coletiva de 07:00. Não existe funcionário nem escala pré-carregados
      // para o registro de ponto: todas as IDs vêm dos formulários anteriores.
      const employeeRequest=(path:string,body?:object,cookie?:string,csrf?:string)=>
        app.request(path,{
          method:body?'POST':'GET',
          headers:{
            ...(body?{'Content-Type':'application/json'}:{}),
            ...(cookie?{Cookie:cookie}:{}),
            ...(csrf?{'X-CSRF-Token':csrf}:{})
          },
          ...(body?{body:JSON.stringify(body)}:{})
        },env);
      const loginAna=async(password:string)=>{
        const response=await employeeRequest('/api/employee/cpf-auth/login',{
          cpf:'11144477735',password
        });
        const data=await response.json() as any;
        return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
      };
      let anaLogin=await loginAna(ana.temporary_password);
      expect(anaLogin.response.status).toBe(200);
      expect(anaLogin.data.selection_required).toBe(false);
      const firstSession=await employeeRequest(
        '/api/employee/cpf-auth/session',undefined,anaLogin.cookie
      );
      expect(firstSession.status).toBe(200);
      const firstData=await firstSession.json() as any;
      expect(firstData.user.employee_id).toBe(ana.employee.id);
      expect(firstData.company.id).toBe('co-a');
      expect(firstData.user.must_change_password).toBe(true);
      expect((await employeeRequest('/api/employee/cpf-work/today',
        undefined,anaLogin.cookie)).status).toBe(403);
      const newPassword='SenhaDefinitivaAna2026!';
      const changePassword=await employeeRequest(
        '/api/employee/cpf-auth/password',{
          current_password:ana.temporary_password,new_password:newPassword
        },anaLogin.cookie,firstData.csrf_token
      );
      expect(changePassword.status).toBe(200);
      expect((await employeeRequest('/api/employee/cpf-auth/session',
        undefined,anaLogin.cookie)).status).toBe(401);
      expect((await loginAna(ana.temporary_password)).response.status).toBe(401);
      anaLogin=await loginAna(newPassword);
      expect(anaLogin.response.status).toBe(200);
      const types=['entry','break_start','break_end','exit'] as const;
      const marks=[at(7),at(11),at(12),at(16)];
      const keys=[
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444'
      ];
      const receipts:string[]=[];
      let renewals=0;
      const session=await employeeRequest(
        '/api/employee/cpf-auth/session',undefined,anaLogin.cookie
      );
      expect(session.status).toBe(200);
      let csrfEmployee=(await session.json() as any).csrf_token as string;
      for(let i=0;i<4;i++){
        vi.mocked(Date.now).mockReturnValue(marks[i]);
        let today=await employeeRequest(
          '/api/employee/cpf-work/today',undefined,anaLogin.cookie
        );
        if(today.status===401){
          renewals++;
          anaLogin=await loginAna(newPassword);
          expect(anaLogin.response.status).toBe(200);
          const renewed=await employeeRequest(
            '/api/employee/cpf-auth/session',undefined,anaLogin.cookie
          );
          expect(renewed.status).toBe(200);
          csrfEmployee=(await renewed.json() as any).csrf_token;
          today=await employeeRequest(
            '/api/employee/cpf-work/today',undefined,anaLogin.cookie
          );
        }
        expect(today.status).toBe(200);
        expect(await today.json()).toMatchObject({
          company_id:'co-a',employee_id:ana.employee.id,
          work_date:'2026-10-26',next_seq:i,next_type:types[i]
        });
        const punch=await employeeRequest('/api/employee/cpf-work/punch',{
          type:types[i],idempotency_key:keys[i]
        },anaLogin.cookie,csrfEmployee);
        const confirmed=await punch.json() as any;
        expect(punch.status,JSON.stringify(confirmed)).toBe(201);
        expect(confirmed.punch.type).toBe(types[i]);
        expect(confirmed.punch.recorded_at).toBe(marks[i]);
        receipts.push(confirmed.punch.receipt_hash);
        const retry=await employeeRequest('/api/employee/cpf-work/punch',{
          type:types[i],idempotency_key:keys[i]
        },anaLogin.cookie,csrfEmployee);
        expect(retry.status).toBe(200);
        expect((await retry.json() as any).replayed).toBe(true);
      }
      expect(renewals).toBeGreaterThanOrEqual(2);
      const punches=await db.prepare(
        'SELECT employee_id,seq,type,receipt_hash FROM punches ORDER BY seq'
      ).all<any>();
      expect(punches.results).toEqual([
        {employee_id:ana.employee.id,seq:0,type:'entry',receipt_hash:receipts[0]},
        {employee_id:ana.employee.id,seq:1,type:'break_start',receipt_hash:receipts[1]},
        {employee_id:ana.employee.id,seq:2,type:'break_end',receipt_hash:receipts[2]},
        {employee_id:ana.employee.id,seq:3,type:'exit',receipt_hash:receipts[3]}
      ]);
      expect(new Set(receipts).size).toBe(4);
      expect((await db.prepare('SELECT company_id,employee_id,work_date,next_seq FROM work_days')
        .first<any>())).toEqual({
        company_id:'co-a',employee_id:ana.employee.id,work_date:'2026-10-26',next_seq:4
      });
      const history=await employeeRequest(
        '/api/employee/cpf-work/history?month=2026-10&company_id=co-b',
        undefined,anaLogin.cookie
      );
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject({
        company_id:'co-a',employee_id:ana.employee.id,
        days:[{date:'2026-10-26',punches:expect.arrayContaining([
          expect.objectContaining({type:'entry'}),
          expect.objectContaining({type:'exit'})
        ])}]
      });
      const tooMany=await employeeRequest('/api/employee/cpf-work/punch',{
        type:'entry',idempotency_key:'55555555-5555-4555-8555-555555555555'
      },anaLogin.cookie,csrfEmployee);
      expect(tooMany.status).toBe(409);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM punches')
        .first<{total:number}>())?.total).toBe(4);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM company_admin_write_guards')
        .first<{total:number}>())?.total).toBe(0);

      // Segundo dia, mesma empresa e funcionario diferente: o gestor mudou
      // a escala de João para 13h na terça-feira. Provar com quatro batidas
      // reais no turno novo, sem alterar os quatro pontos de Ana na segunda.
      const loginJoao=async(password:string)=>{
        const response=await employeeRequest('/api/employee/cpf-auth/login',{
          cpf,password
        });
        return {
          response,
          cookie:response.headers.get('set-cookie')?.split(';')[0]||''
        };
      };
      let joaoLogin=await loginJoao(a.temporary_password);
      expect(joaoLogin.response.status).toBe(200);
      let joaoCookie=joaoLogin.cookie;
      const joaoInitialSession=await employeeRequest(
        '/api/employee/cpf-auth/session',undefined,joaoCookie
      );
      expect(joaoInitialSession.status).toBe(200);
      const joaoInitial=await joaoInitialSession.json() as any;
      expect(joaoInitial.user.employee_id).toBe(a.employee.id);
      expect(joaoInitial.company.id).toBe('co-a');
      expect(joaoInitial.user.must_change_password).toBe(true);
      const joaoPassword='SenhaDefinitivaJoao2026!';
      const joaoChange=await employeeRequest('/api/employee/cpf-auth/password',{
        current_password:a.temporary_password,new_password:joaoPassword
      },joaoCookie,joaoInitial.csrf_token);
      expect(joaoChange.status).toBe(200);
      expect((await employeeRequest('/api/employee/cpf-auth/session',
        undefined,joaoCookie)).status).toBe(401);

      const tuesday=(hour:number)=>at(hour)+86400000;
      vi.mocked(Date.now).mockReturnValue(tuesday(13));
      joaoLogin=await loginJoao(joaoPassword);
      expect(joaoLogin.response.status).toBe(200);
      joaoCookie=joaoLogin.cookie;
      const joaoActiveSession=await employeeRequest(
        '/api/employee/cpf-auth/session',undefined,joaoCookie
      );
      expect(joaoActiveSession.status).toBe(200);
      let joaoCsrf=(await joaoActiveSession.json() as any).csrf_token as string;
      const joaoMarks=[tuesday(13),tuesday(16),tuesday(17),tuesday(22)];
      const joaoKeys=[
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
        '99999999-9999-4999-8999-999999999999'
      ];
      for(let i=0;i<types.length;i++){
        vi.mocked(Date.now).mockReturnValue(joaoMarks[i]);
        let preview=await employeeRequest(
          '/api/employee/cpf-work/today',undefined,joaoCookie
        );
        if(preview.status===401){
          joaoLogin=await loginJoao(joaoPassword);
          expect(joaoLogin.response.status).toBe(200);
          joaoCookie=joaoLogin.cookie;
          const renewed=await employeeRequest(
            '/api/employee/cpf-auth/session',undefined,joaoCookie
          );
          expect(renewed.status).toBe(200);
          joaoCsrf=(await renewed.json() as any).csrf_token;
          preview=await employeeRequest(
            '/api/employee/cpf-work/today',undefined,joaoCookie
          );
        }
        expect(preview.status).toBe(200);
        expect(await preview.json()).toMatchObject({
          company_id:'co-a',employee_id:a.employee.id,
          work_date:'2026-10-27',next_seq:i,next_type:types[i]
        });
        const punch=await employeeRequest('/api/employee/cpf-work/punch',{
          type:types[i],idempotency_key:joaoKeys[i]
        },joaoCookie,joaoCsrf);
        const result=await punch.json() as any;
        expect(punch.status,JSON.stringify(result)).toBe(201);
        expect(result.punch.recorded_at).toBe(joaoMarks[i]);
        expect(result.punch.work_date).toBe('2026-10-27');
        const retry=await employeeRequest('/api/employee/cpf-work/punch',{
          type:types[i],idempotency_key:joaoKeys[i]
        },joaoCookie,joaoCsrf);
        expect(retry.status).toBe(200);
        expect((await retry.json() as any).replayed).toBe(true);
      }
      const daysAfter=await db.prepare([
        'SELECT employee_id,work_date,next_seq,schedule_json FROM work_days',
        'ORDER BY work_date,employee_id'
      ].join(' ')).all<any>();
      expect(daysAfter.results).toHaveLength(2);
      const anaMonday=daysAfter.results!.find(
        x=>x.employee_id===ana.employee.id&&x.work_date==='2026-10-26'
      );
      const joaoTuesday=daysAfter.results!.find(
        x=>x.employee_id===a.employee.id&&x.work_date==='2026-10-27'
      );
      expect(anaMonday?.next_seq).toBe(4);
      expect(JSON.parse(anaMonday.schedule_json).start).toBe('07:00');
      expect(joaoTuesday?.next_seq).toBe(4);
      expect(JSON.parse(joaoTuesday.schedule_json).start).toBe('13:00');
      expect(JSON.parse(joaoTuesday.schedule_json).end).toBe('22:00');
      const joaoHistory=await employeeRequest(
        '/api/employee/cpf-work/history?month=2026-10&company_id=co-b',
        undefined,joaoCookie
      );
      expect(joaoHistory.status).toBe(200);
      expect(await joaoHistory.json()).toMatchObject({
        company_id:'co-a',employee_id:a.employee.id,
        days:[{date:'2026-10-27',next_seq:4,
          punches:expect.arrayContaining([
            expect.objectContaining({type:'entry'}),
            expect.objectContaining({type:'exit'})
          ])}]
      });
      const allPunches=await db.prepare([
        'SELECT p.employee_id,d.work_date,p.seq,p.type,p.recorded_at',
        'FROM punches p JOIN work_days d ON d.id=p.work_day_id',
        'ORDER BY d.work_date,p.seq'
      ].join(' ')).all<any>();
      expect(allPunches.results).toHaveLength(8);
      expect(allPunches.results!.filter(x=>x.employee_id===ana.employee.id)
        .map(x=>x.recorded_at)).toEqual(marks);
      expect(allPunches.results!.filter(x=>x.employee_id===a.employee.id)
        .map(x=>x.recorded_at)).toEqual(joaoMarks);
      expect(allPunches.results).not.toEqual(expect.arrayContaining([
        expect.objectContaining({employee_id:b.employee.id})
      ]));

      // O mesmo João registra quarta às 07h, conforme a exceção diária
      // do modelo da tarde (sem criar outra atribuição). Os snapshots de
      // segunda/terça continuam imutáveis, assim como os pontos de Ana.
      const wednesday=(hour:number)=>at(hour)+2*86400000;
      const wednesdayMarks=[wednesday(7),wednesday(11),
        wednesday(12),wednesday(16)];
      const wednesdayKeys=[
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      ];
      for(let i=0;i<types.length;i++){
        vi.mocked(Date.now).mockReturnValue(wednesdayMarks[i]);
        let preview=await employeeRequest(
          '/api/employee/cpf-work/today',undefined,joaoCookie
        );
        if(preview.status===401){
          joaoLogin=await loginJoao(joaoPassword);
          expect(joaoLogin.response.status).toBe(200);
          joaoCookie=joaoLogin.cookie;
          const renewed=await employeeRequest(
            '/api/employee/cpf-auth/session',undefined,joaoCookie
          );
          expect(renewed.status).toBe(200);
          joaoCsrf=(await renewed.json() as any).csrf_token;
          preview=await employeeRequest(
            '/api/employee/cpf-work/today',undefined,joaoCookie
          );
        }
        expect(preview.status).toBe(200);
        expect(await preview.json()).toMatchObject({
          company_id:'co-a',employee_id:a.employee.id,
          work_date:'2026-10-28',next_seq:i,next_type:types[i]
        });
        const stamp=await employeeRequest('/api/employee/cpf-work/punch',{
          type:types[i],idempotency_key:wednesdayKeys[i]
        },joaoCookie,joaoCsrf);
        const result=await stamp.json() as any;
        expect(stamp.status,JSON.stringify(result)).toBe(201);
        expect(result.punch.recorded_at).toBe(wednesdayMarks[i]);
        expect(result.punch.work_date).toBe('2026-10-28');
        const retry=await employeeRequest('/api/employee/cpf-work/punch',{
          type:types[i],idempotency_key:wednesdayKeys[i]
        },joaoCookie,joaoCsrf);
        expect(retry.status).toBe(200);
        expect((await retry.json() as any).replayed).toBe(true);
      }
      const completedDays=await db.prepare(
        'SELECT employee_id,work_date,next_seq,schedule_json FROM work_days'
      ).all<any>();
      expect(completedDays.results).toHaveLength(3);
      const wednesdayDay=completedDays.results!.find(
        x=>x.employee_id===a.employee.id&&x.work_date==='2026-10-28'
      );
      expect(wednesdayDay?.next_seq).toBe(4);
      expect(JSON.parse(wednesdayDay.schedule_json).start).toBe('07:00');
      expect(JSON.parse(wednesdayDay.schedule_json).end).toBe('16:00');
      expect((completedDays.results!.find(x=>
        x.employee_id===a.employee.id&&x.work_date==='2026-10-27'
      )?.next_seq)).toBe(4);
      expect((completedDays.results!.find(x=>
        x.employee_id===ana.employee.id&&x.work_date==='2026-10-26'
      )?.next_seq)).toBe(4);
      expect((await db.prepare('SELECT COUNT(*) AS n FROM punches')
        .first<{n:number}>())?.n).toBe(12);
      const wednesdayHistory=await employeeRequest(
        '/api/employee/cpf-work/history?month=2026-10',
        undefined,joaoCookie
      );
      expect(wednesdayHistory.status).toBe(200);
      expect(await wednesdayHistory.json()).toMatchObject({
        company_id:'co-a',employee_id:a.employee.id,
        days:[
          {date:'2026-10-27',next_seq:4,punches:expect.any(Array)},
          {date:'2026-10-28',next_seq:4,punches:expect.any(Array)}
        ]
      });
      const totalAssignments=await db.prepare(
        'SELECT COUNT(*) AS n FROM schedule_assignments'
      ).first<{n:number}>();
      expect(totalAssignments?.n).toBe(4);
      await db.prepare('ALTER TABLE company_admins ADD COLUMN password_hash TEXT').run();
      const managerPassword='Manager-Test-Only-2026!';
      // Reinicia os dois gestores fictícios após o cenário anterior de suspensão.
      await db.prepare('UPDATE company_admins SET password_hash=?,active=1').bind(await hashPassword(managerPassword,pepper)).run();
      await db.prepare('UPDATE company_admin_sessions SET expires_at=?,last_seen_at=?').bind(Date.now()+600000,Date.now()).run();
      const statusRequest=(body:object,token=tokenA,csrf='csrf-a')=>app.request('/api/company/employees/'+a.employee.id+'/status',{
        method:'POST',headers:{Cookie:'cr_jornada_company_dev='+token,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)
      },env);
      const profile=async()=>await db.prepare('SELECT status,updated_at,employment_end FROM employees WHERE id=?').bind(a.employee.id).first<any>();
      const initialProfile=await profile();
      const statusBody={status:'blocked',reason:'Bloqueio fictício de homologação',current_password:managerPassword,expected_updated_at:initialProfile.updated_at};
      expect((await statusRequest(statusBody,tokenB,'csrf-b')).status).toBe(404);
      expect((await statusRequest(statusBody,tokenA,'invalid')).status).toBe(403);
      expect((await statusRequest({...statusBody,current_password:'incorrect-password'})).status).toBe(403);
      const authBefore=await db.prepare('SELECT auth_version FROM users WHERE employee_id=?').bind(a.employee.id).first<any>();
      expect((await statusRequest(statusBody)).status).toBe(200);
      expect((await profile()).status).toBe('blocked');
      expect((await employeeRequest('/api/employee/cpf-auth/session',undefined,joaoCookie)).status).toBe(401);
      expect((await statusRequest(statusBody)).status).toBe(409);
      expect((await statusRequest({...statusBody,status:'active',expected_updated_at:(await profile()).updated_at})).status).toBe(200);
      expect((await employeeRequest('/api/employee/cpf-auth/session',undefined,joaoCookie)).status).toBe(401);
      const authAfter=await db.prepare('SELECT active,auth_version FROM users WHERE employee_id=?').bind(a.employee.id).first<any>();
      expect(authAfter.active).toBe(1);expect(authAfter.auth_version).toBeGreaterThan(authBefore.auth_version);
      const termination={...statusBody,status:'terminated',employment_end:'2026-10-28',expected_updated_at:(await profile()).updated_at};
      expect((await statusRequest({...termination,employment_end:'2026-10-27'})).status).toBe(409);
      expect((await statusRequest({...termination,employment_end:'2026-11-01'})).status).toBe(400);
      await db.prepare(`INSERT INTO work_days(id,employee_id,work_date,timezone,schedule_json,rules_json,next_seq,created_at,last_at,company_id)
        SELECT 'test-open-day',employee_id,'2026-10-29',timezone,schedule_json,rules_json,1,created_at,last_at,company_id FROM work_days WHERE employee_id=? LIMIT 1`).bind(a.employee.id).run();
      expect((await statusRequest(termination)).status).toBe(409);
      await db.prepare("UPDATE work_days SET company_id=NULL,next_seq=0 WHERE id='test-open-day'").run();
      expect((await statusRequest(termination)).status).toBe(409);
      await db.prepare("DELETE FROM work_days WHERE id='test-open-day'").run();
      await db.prepare("CREATE TRIGGER reject_status_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END").run();
      expect((await statusRequest({...statusBody,expected_updated_at:(await profile()).updated_at})).status).toBe(500);
      expect((await profile()).status).toBe('active');
      expect((await db.prepare('SELECT active,auth_version FROM users WHERE employee_id=?').bind(a.employee.id).first<any>())).toEqual(authAfter);
      await db.prepare('DROP TRIGGER reject_status_audit').run();
      expect((await statusRequest(termination)).status).toBe(200);
      expect(await profile()).toMatchObject({status:'terminated',employment_end:'2026-10-28'});
      expect((await statusRequest({...statusBody,status:'active',expected_updated_at:(await profile()).updated_at})).status).toBe(409);
      expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='company.employee.status_changed'").first<any>()).n).toBe(3);
      expect((await db.prepare('SELECT COUNT(*) AS n FROM punches').first<any>()).n).toBe(12);
      expect((await db.prepare('SELECT status FROM employees WHERE id=?').bind(b.employee.id).first<any>()).status).toBe('active');
      expect((await db.prepare('SELECT COUNT(*) AS total FROM company_admin_write_guards')
        .first<{total:number}>())?.total).toBe(0);
      const guards=await db.prepare('SELECT COUNT(*) AS total FROM company_employee_write_guards').first<{total:number}>();
      expect(guards?.total).toBe(0);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
    }finally{
      await mf.dispose();
    }
  },120000);
});
