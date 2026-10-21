import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companyEmployeesRoutes } from '../server/routes/company-employees';
import { companySchedulesRoutes } from '../server/routes/company-schedules';
import { employeeCpfLookupKey } from '../server/core/employee-cpf';
import { sha256, verifyPassword } from '../server/core/crypto';

const pepper='cr-jornada-onboarding-pepper-test-2026';
const cpfSecret='cr-jornada-onboarding-cpf-secret-2026';
const dataKey='a'.repeat(64);
const tokenA='a'.repeat(64);
const tokenB='b'.repeat(64);
const cpf='52998224725';

const payload=(name:string,registration='001',cpfValue=cpf)=>({
  full_name:name,registration,cpf:cpfValue,
  job_title:'Atendente',admission_date:'2026-10-21'
});

describe('CR JORNADA — cadastro empresarial D1 local de ponta a ponta',()=>{
  it('duas empresas criam funcionários, isolam CPF/matrícula e protegem acessos',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({
      workers:[{name:'test',modules:true,
        script:'export default { fetch() { return new Response("ok") } }',
        d1Databases:['DB']}]
    }));
    try{
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession() as unknown as D1DatabaseSession;
      await db.batch([
        db.prepare("CREATE TABLE companies(id TEXT PRIMARY KEY,slug TEXT,status TEXT NOT NULL)"),
        db.prepare("CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,display_name TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER)"),
        db.prepare("CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,company_id TEXT,csrf_token TEXT,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)"),
        db.prepare("CREATE TABLE employees(id TEXT PRIMARY KEY,full_name TEXT,registration TEXT UNIQUE,company_registration TEXT,cpf_encrypted TEXT,cpf_last4 TEXT,job_title TEXT,admission_date TEXT,employment_end TEXT,status TEXT,notes TEXT,created_at INTEGER,updated_at INTEGER,company_id TEXT,deleted_at INTEGER,UNIQUE(company_id,company_registration))"),
        db.prepare("CREATE TABLE users(id TEXT PRIMARY KEY,login TEXT UNIQUE,email TEXT,display_name TEXT,password_hash TEXT,role TEXT,employee_id TEXT,active INTEGER,must_change_password INTEGER,employee_temporary_password_expires_at INTEGER,created_at INTEGER,updated_at INTEGER)"),
        db.prepare("CREATE TABLE employee_cpf_links(employee_id TEXT PRIMARY KEY,company_id TEXT,cpf_lookup_key TEXT,created_at INTEGER,updated_at INTEGER,UNIQUE(company_id,cpf_lookup_key))"),
        db.prepare("CREATE TABLE company_employee_registration_audit(id TEXT PRIMARY KEY,company_id TEXT,employee_id TEXT,admin_id TEXT,action TEXT,created_at INTEGER)"),
        db.prepare("CREATE TABLE company_employee_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER NOT NULL CHECK(affected_rows=1))"),
        db.prepare('CREATE TABLE schedules(id TEXT PRIMARY KEY,name TEXT,config_json TEXT,created_by TEXT,created_at INTEGER,company_id TEXT,deleted_at INTEGER)'),
        db.prepare('CREATE TABLE schedule_history(id TEXT PRIMARY KEY,schedule_id TEXT,effective_from TEXT,config_json TEXT)'),
        db.prepare('CREATE TABLE schedule_assignments(id TEXT PRIMARY KEY,employee_id TEXT,schedule_id TEXT,effective_from TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE schedule_assignment_cancellations(assignment_id TEXT PRIMARY KEY)'),
        db.prepare('CREATE TABLE company_schedule_audit(id TEXT PRIMARY KEY,company_id TEXT,admin_id TEXT,action TEXT,schedule_id TEXT,employee_id TEXT,details_json TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE company_schedule_create_requests(company_id TEXT,admin_id TEXT,request_key TEXT,request_fingerprint TEXT,schedule_id TEXT,created_at INTEGER,PRIMARY KEY(company_id,admin_id,request_key))'),
        db.prepare("CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)"),
        db.prepare("INSERT INTO companies VALUES ('co-a','empresa-a','active'),('co-b','empresa-b','active')"),
        db.prepare("INSERT INTO company_admins VALUES('admin-a','co-a','gestor-a','Gestor A',1,1,0,NULL),('admin-b','co-b','gestor-b','Gestor B',1,1,0,NULL)"),
        db.prepare("INSERT INTO company_admin_sessions VALUES (?,?,?,?,?,?,1)")
          .bind(sha256(tokenA),'admin-a','co-a','csrf-a',Date.now()+600000,Date.now()),
        db.prepare("INSERT INTO company_admin_sessions VALUES (?,?,?,?,?,?,1)")
          .bind(sha256(tokenB),'admin-b','co-b','csrf-b',Date.now()+600000,Date.now())
      ]);
      const app=new Hono<App>();
      app.use('*',async(c,next)=>{c.set('db',db);await next();});
      app.route('/api/company/employees',companyEmployeesRoutes);
      app.route('/api/company/schedules',companySchedulesRoutes);
      app.onError((e,c)=>e instanceof ApiError
        ?c.json({error:{code:e.code,message:e.message}},e.status as any)
        :c.json({error:{code:'internal_error',message:String(e)}},500));
      const env={
        ENVIRONMENT:'development' as const,
        ENABLE_COMPANY_EMPLOYEE_REGISTRATION:'true',
        ENABLE_COMPANY_SCHEDULES:'true',
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
        break_start:'16:00',break_end:'17:00',end:'22:00'
      };
      const schedulePost=(token:string,csrf:string,path:string,data:object)=>
        app.request('/api/company/schedules'+path,{
          method:'POST',headers:{
            Cookie:'cr_jornada_company_dev='+token,
            'X-CSRF-Token':csrf,'Content-Type':'application/json'
          },body:JSON.stringify(data)
        },env);
      const scheduleGet=(token:string,path:string)=>
        app.request('/api/company/schedules'+path,{
          headers:{Cookie:'cr_jornada_company_dev='+token}
        },env);
      const morningA=await schedulePost(tokenA,'csrf-a','/',morning);
      expect(morningA.status).toBe(201);
      const scheduleA=(await morningA.json() as any).id as string;
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
      expect(anaDays[0].shift.start).toBe('07:00');
      expect(anaDays[1].shift.start).toBe('07:00');
      expect(mariaDays[1].shift.start).toBe('07:00');
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
      const guards=await db.prepare('SELECT COUNT(*) AS total FROM company_employee_write_guards').first<{total:number}>();
      expect(guards?.total).toBe(0);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
    }finally{
      await mf.dispose();
    }
  },120000);
});
