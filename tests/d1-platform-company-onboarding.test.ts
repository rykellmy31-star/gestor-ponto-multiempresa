import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { hashPassword, verifyPassword } from '../server/core/crypto';
import { platformAuthRoutes } from '../server/routes/platform-auth';
import { platformCompaniesRoutes } from '../server/routes/platform-companies';
import { companyAuthRoutes } from '../server/routes/company-auth';

// Routes and D1 are real; only the people and schema fixtures are synthetic.
// Never use remote D1, Cloudflare secrets or real company credentials.
describe('CR JORNADA — Superadmin cria duas empresas e gestores reais no D1 local',()=>{
  it('autentica, cria empresas, isola gestores, troca senha e suspende somente A',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({
      workers:[{name:'test',modules:true,
        script:'export default { fetch() { return new Response("ok") } }',
        d1Databases:['DB']}]
    }));
    try{
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession() as unknown as D1DatabaseSession;
      const pepper='cr-jornada-superadmin-test-pepper-2026';
      const superPass='Superadmin-Senha-2026!';
      const managerPass='GestorInicial-2026!';
      const managerNew='GestorDefinitiva-2026!';
      const now=Date.now();
      await db.batch([
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)'),
        db.prepare('CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,document TEXT NOT NULL DEFAULT \'\',slug TEXT UNIQUE COLLATE NOCASE,logo_url TEXT,primary_color TEXT,timezone TEXT,status TEXT,created_at INTEGER,updated_at INTEGER)'),
        db.prepare('CREATE TABLE platform_admins(id TEXT PRIMARY KEY,login TEXT UNIQUE COLLATE NOCASE,email TEXT,display_name TEXT,password_hash TEXT,active INTEGER,auth_version INTEGER,created_at INTEGER,updated_at INTEGER)'),
        db.prepare('CREATE TABLE platform_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,last_seen_at INTEGER,reauth_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE platform_audit_log(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,details_json TEXT,created_at INTEGER)'),
        db.prepare('CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT COLLATE NOCASE,email TEXT COLLATE NOCASE,display_name TEXT,password_hash TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER NOT NULL DEFAULT 1,temporary_password_expires_at INTEGER,created_at INTEGER,updated_at INTEGER,UNIQUE(company_id,login))'),
        db.prepare('CREATE UNIQUE INDEX company_admins_company_email ON company_admins(company_id,email) WHERE email IS NOT NULL'),
        db.prepare('CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,company_id TEXT,admin_id TEXT,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE employee_company_sessions(token_hash TEXT PRIMARY KEY,company_id TEXT NOT NULL)'),
        db.prepare('CREATE TABLE company_admin_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER NOT NULL CONSTRAINT company_admin_write_conflict CHECK(affected_rows=1))'),
        db.prepare('CREATE TABLE company_admin_security_events(id TEXT PRIMARY KEY,company_id TEXT,admin_id TEXT,action TEXT,created_at INTEGER)'),
        db.prepare('INSERT INTO platform_admins VALUES(?,?,?,?,?,1,1,?,?)')
          .bind('super-a','root-cr',null,'Superadmin Fictício',
            await hashPassword(superPass,pepper),now,now)
      ]);
      const app=new Hono<App>();
      app.use('*',async(c,next)=>{c.set('db',db);await next();});
      app.route('/api/platform/auth',platformAuthRoutes);
      app.route('/api/platform/companies',platformCompaniesRoutes);
      app.route('/api/company/auth',companyAuthRoutes);
      app.onError((e,c)=>e instanceof ApiError
        ?c.json({error:{code:e.code,message:e.message}},e.status as any)
        :c.json({error:{code:'internal_error',message:String(e)}},500));
      const env={
        AUTH_PEPPER:pepper,ENVIRONMENT:'development',SESSION_HOURS:'8'
      } as any;
      const call=(path:string,method:'GET'|'POST'|'PATCH'|'PUT',
        body?:object,cookie?:string,csrf?:string)=>app.request(path,{
          method,
          headers:{
            ...(body?{'Content-Type':'application/json'}:{}),
            ...(cookie?{Cookie:cookie}:{}),
            ...(csrf?{'X-CSRF-Token':csrf}:{})
          },
          ...(body?{body:JSON.stringify(body)}:{})
        },env);
      const auth=await call('/api/platform/auth/login','POST',{
        login:'root-cr',password:superPass
      });
      expect(auth.status).toBe(200);
      const superCookie=auth.headers.get('set-cookie')?.split(';')[0]||'';
      expect(superCookie).toContain('cr_jornada_platform_dev=');
      const superSession=await call('/api/platform/auth/session','GET',undefined,superCookie);
      expect(superSession.status).toBe(200);
      const session=await superSession.json() as any;
      expect(session.user.role).toBe('superadmin');
      const csrf=session.csrf_token as string;
      const create=(slug:string,name:string)=>
        call('/api/platform/companies','POST',{
          name,document:'',slug,primary_color:'#0F766E',
          timezone:'America/Bahia'
        },superCookie,csrf);
      const coA=await create('empresa-ficticia-a','Empresa Fictícia A');
      const coB=await create('empresa-ficticia-b','Empresa Fictícia B');
      expect(coA.status).toBe(201);
      expect(coB.status).toBe(201);
      const companyA=(await coA.json() as any).company;
      const companyB=(await coB.json() as any).company;
      expect(companyA.id).not.toBe(companyB.id);
      expect((await create('empresa-ficticia-a','Duplicada')).status).toBe(409);
      expect((await call('/api/platform/companies','POST',{
        name:'Invasora',document:'',slug:'empresa-invasora'
      },superCookie,'csrf-invalido')).status).toBe(403);
      expect((await call('/api/platform/companies','POST',{
        name:'Invasora',document:'',slug:'empresa-invasora'
      })).status).toBe(401);
      const list=await call('/api/platform/companies','GET',undefined,superCookie);
      expect(list.status).toBe(200);
      expect((await list.json() as any).companies.map((c:any)=>c.slug).sort())
        .toEqual(['empresa-ficticia-a','empresa-ficticia-b']);
      // O Superadmin edita só a empresa A; B mantém identidade e visual.
      const edit=await call('/api/platform/companies/'+companyA.id,'PUT',{
        name:'Empresa Fictícia A Atualizada',document:'',
        slug:'empresa-ficticia-a',logo_url:null,
        primary_color:'#17424A',timezone:'America/Bahia'
      },superCookie,csrf);
      expect(edit.status).toBe(200);
      expect(edit.headers.get('cache-control')).toContain('no-store');
      expect((await edit.json() as any).success).toBe(true);
      const updatedA=await call('/api/platform/companies/'+companyA.id,'GET',
        undefined,superCookie);
      expect((await updatedA.json() as any).company).toMatchObject({
        name:'Empresa Fictícia A Atualizada',primary_color:'#17424A',status:'active'
      });
      const untouchedB=await call('/api/platform/companies/'+companyB.id,'GET',
        undefined,superCookie);
      expect((await untouchedB.json() as any).company).toMatchObject({
        name:'Empresa Fictícia B',primary_color:'#0F766E',status:'active'
      });
      expect((await call('/api/platform/companies/'+companyA.id,'PUT',{
        name:'Duplicar endereço',document:'',slug:companyB.slug
      },superCookie,csrf)).status).toBe(409);
      expect((await call('/api/platform/companies/'+companyA.id,'PUT',{
        name:'Sem CSRF',document:'',slug:companyA.slug
      },superCookie,'invalido')).status).toBe(403);
      const newManager=async(companyId:string,login:string)=>
        call('/api/platform/companies/'+companyId+'/admins','POST',{
          name:'Gestor '+login,login,email:'',password:managerPass
        },superCookie,csrf);
      const managerA=await newManager(companyA.id,'gerente');
      const managerB=await newManager(companyB.id,'gerente');
      expect(managerA.status).toBe(201);
      expect(managerB.status).toBe(201);
      const dataA=(await managerA.json() as any).admin;
      const dataB=(await managerB.json() as any).admin;
      expect(dataA.company_id).toBe(companyA.id);
      expect(dataB.company_id).toBe(companyB.id);
      expect(dataA.id).not.toBe(dataB.id);
      expect(JSON.stringify(dataA)).not.toContain('password_hash');
      // O mesmo login em duas empresas e legitimo. Duplicar o login
      // somente dentro da mesma empresa deve devolver 409 sem auditoria.
      const duplicateLogin=await newManager(companyA.id,'GERENTE');
      expect(duplicateLogin.status).toBe(409);
      expect((await duplicateLogin.json() as any).error.code)
        .toBe('company_admin_already_exists');
      const uniqueEmail=async(companyId:string,login:string,email:string)=>
        call('/api/platform/companies/'+companyId+'/admins','POST',{
          name:'Gestor '+login,login,email,password:managerPass
        },superCookie,csrf);
      expect((await uniqueEmail(companyA.id,'terceiro','gestor@example.test')).status)
        .toBe(201);
      const duplicateEmail=await uniqueEmail(
        companyA.id,'quarto','GESTOR@example.test'
      );
      expect(duplicateEmail.status).toBe(409);
      expect((await duplicateEmail.json() as any).error.code)
        .toBe('company_admin_already_exists');
      expect((await uniqueEmail(companyB.id,'quinto','gestor@example.test')).status)
        .toBe(201);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM company_admins')
        .first<{total:number}>())?.total).toBe(4);
      const saved=await db.prepare(
        'SELECT company_id,password_hash,must_change_password FROM company_admins ORDER BY company_id'
      ).all<any>();
      expect(saved.results).toHaveLength(4);
      expect(await verifyPassword(managerPass,saved.results![0].password_hash,pepper)).toBe(true);
      expect(saved.results!.every(a=>a.must_change_password===1)).toBe(true);
      const loginManager=(slug:string,password:string)=>call(
        '/api/company/auth/login','POST',{
          company:slug,login:'gerente',password
        }
      );
      const managerLoginA=await loginManager(companyA.slug,managerPass);
      const managerLoginB=await loginManager(companyB.slug,managerPass);
      expect(managerLoginA.status).toBe(200);
      expect(managerLoginB.status).toBe(200);
      const cookieA=managerLoginA.headers.get('set-cookie')?.split(';')[0]||'';
      const cookieB=managerLoginB.headers.get('set-cookie')?.split(';')[0]||'';
      expect(cookieA).toContain('cr_jornada_company_dev=');
      const managerSessionA=await call('/api/company/auth/session','GET',undefined,cookieA);
      expect(managerSessionA.status).toBe(200);
      const mgrSession=await managerSessionA.json() as any;
      expect(mgrSession.company.id).toBe(companyA.id);
      expect(mgrSession.must_change_password).toBe(true);
      const change=await call('/api/company/auth/change-password','POST',{
        current_password:managerPass,new_password:managerNew
      },cookieA,mgrSession.csrf_token);
      expect(change.status).toBe(200);
      expect((await change.json() as any).requires_login).toBe(true);
      expect((await call('/api/company/auth/session','GET',undefined,cookieA)).status)
        .toBe(401);
      expect((await loginManager(companyA.slug,managerPass)).status).toBe(401);
      const changedLogin=await loginManager(companyA.slug,managerNew);
      expect(changedLogin.status).toBe(200);
      const changedCookie=changedLogin.headers.get('set-cookie')?.split(';')[0]||'';
      const changedSession=await call('/api/company/auth/session','GET',undefined,changedCookie);
      expect((await changedSession.json() as any).must_change_password).toBe(false);

      // Uma sessao de funcionario ficticio por empresa: o superadmin
      // precisa revogar somente os acessos da empresa suspensa.
      await db.prepare('INSERT INTO employee_company_sessions VALUES(?,?),(?,?)')
        .bind('employee-token-a',companyA.id,'employee-token-b',companyB.id).run();
      const sessionsBefore=await db.prepare(
        'SELECT company_id,COUNT(*) AS total FROM company_admin_sessions GROUP BY company_id ORDER BY company_id'
      ).all<any>();
      expect(sessionsBefore.results).toHaveLength(2);
      expect(sessionsBefore.results).toEqual(expect.arrayContaining([
        {company_id:companyA.id,total:1},
        {company_id:companyB.id,total:1}
      ]));
      const suspend=await call('/api/platform/companies/'+companyA.id+'/status',
        'PATCH',{status:'suspended'},superCookie,csrf);
      expect(suspend.status).toBe(200);
      const createInSuspended=await uniqueEmail(
        companyA.id,'naoautorizado','suspenso@example.test'
      );
      expect(createInSuspended.status).toBe(409);
      expect((await createInSuspended.json() as any).error.code)
        .toBe('company_inactive');
      expect((await loginManager(companyA.slug,managerNew)).status).toBe(401);
      expect((await call('/api/company/auth/session','GET',undefined,changedCookie)).status)
        .toBe(401);
      expect((await call('/api/company/auth/session','GET',undefined,cookieB)).status)
        .toBe(200);
      const sessionRows=await db.prepare(
        'SELECT company_id,COUNT(*) AS total FROM company_admin_sessions GROUP BY company_id ORDER BY company_id'
      ).all<any>();
      expect(sessionRows.results).toEqual([{company_id:companyB.id,total:1}]);
      const employeeRows=await db.prepare(
        'SELECT company_id,token_hash FROM employee_company_sessions ORDER BY company_id'
      ).all<any>();
      expect(employeeRows.results).toEqual([
        {company_id:companyB.id,token_hash:'employee-token-b'}
      ]);
      const guardsAfterSuspend=await db.prepare(
        'SELECT COUNT(*) AS total FROM company_admin_write_guards'
      ).first<{total:number}>();
      expect(guardsAfterSuspend?.total).toBe(0);
      const resume=await call('/api/platform/companies/'+companyA.id+'/status',
        'PATCH',{status:'active'},superCookie,csrf);
      expect(resume.status).toBe(200);
      // Reativar a empresa NAO restaura os cookies emitidos antes
      // da suspensao. Os gestores precisam entrar novamente.
      expect((await call('/api/company/auth/session','GET',undefined,changedCookie)).status)
        .toBe(401);
      expect((await db.prepare('SELECT COUNT(*) AS total FROM employee_company_sessions WHERE company_id=?')
        .bind(companyA.id).first<{total:number}>())?.total).toBe(0);
      // Recuperação assistida com D1 real: a senha provisória deve
      // invalidar todas as sessões antigas do gestor, sem tocar na empresa B.
      const reactivatedLogin=await loginManager(companyA.slug,managerNew);
      expect(reactivatedLogin.status).toBe(200);
      const reactivatedCookie=reactivatedLogin.headers.get('set-cookie')?.split(';')[0]||'';
      const crossCompanyReset=await call(
        '/api/platform/companies/'+companyB.id+'/admins/'+dataA.id+'/reset-password',
        'POST',undefined,superCookie,csrf
      );
      expect(crossCompanyReset.status).toBe(404);
      expect((await crossCompanyReset.json() as any).error.code)
        .toBe('company_admin_not_found');
      const reset=await call(
        '/api/platform/companies/'+companyA.id+'/admins/'+dataA.id+'/reset-password',
        'POST',undefined,superCookie,csrf
      );
      expect(reset.status).toBe(200);
      expect(reset.headers.get('cache-control')).toContain('no-store');
      const resetData=await reset.json() as any;
      expect(resetData.success).toBe(true);
      expect(resetData.must_change_password).toBe(true);
      expect(resetData.temporary_password).toMatch(/^[a-f0-9]{24}$/);
      expect(resetData.expires_at).toBeGreaterThan(Date.now()+23*3600000);
      expect(resetData.expires_at).toBeLessThanOrEqual(Date.now()+24*3600000);
      const storedReset=await db.prepare(
        'SELECT password_hash,must_change_password,temporary_password_expires_at '+
        'FROM company_admins WHERE id=? AND company_id=?'
      ).bind(dataA.id,companyA.id).first<any>();
      expect(storedReset.must_change_password).toBe(1);
      expect(storedReset.temporary_password_expires_at).toBe(resetData.expires_at);
      expect(await verifyPassword(
        resetData.temporary_password,storedReset.password_hash,pepper
      )).toBe(true);
      expect((await call('/api/company/auth/session','GET',
        undefined,reactivatedCookie)).status).toBe(401);
      expect((await loginManager(companyA.slug,managerNew)).status).toBe(401);
      expect((await call('/api/company/auth/session','GET',
        undefined,cookieB)).status).toBe(200);
      const tempLogin=await loginManager(companyA.slug,resetData.temporary_password);
      expect(tempLogin.status).toBe(200);
      const tempCookie=tempLogin.headers.get('set-cookie')?.split(';')[0]||'';
      const tempSession=await call('/api/company/auth/session','GET',undefined,tempCookie);
      expect(tempSession.status).toBe(200);
      expect((await tempSession.json() as any).must_change_password).toBe(true);
      // Trocar a senha temporária pelo gestor invalida também o cookie da
      // senha provisória; o próximo acesso usa apenas a senha definitiva.
      const tempData=await call('/api/company/auth/session','GET',undefined,tempCookie);
      const tempCsrf=(await tempData.json() as any).csrf_token;
      const finalPassword='GestorRenovado-2026!';
      const finalChange=await call('/api/company/auth/change-password','POST',{
        current_password:resetData.temporary_password,new_password:finalPassword
      },tempCookie,tempCsrf);
      expect(finalChange.status).toBe(200);
      expect((await call('/api/company/auth/session','GET',
        undefined,tempCookie)).status).toBe(401);
      expect((await loginManager(companyA.slug,resetData.temporary_password)).status)
        .toBe(401);
      const finalLogin=await loginManager(companyA.slug,finalPassword);
      expect(finalLogin.status).toBe(200);
      const finalCookie=finalLogin.headers.get('set-cookie')?.split(';')[0]||'';
      expect((await call('/api/company/auth/session','GET',
        undefined,finalCookie)).status).toBe(200);
      expect((await call('/api/company/auth/session','GET',
        undefined,cookieB)).status).toBe(200);
      expect((await call('/api/platform/companies/'+companyA.id+'/admins','GET',
        undefined,superCookie)).status).toBe(200);
      expect((await call('/api/platform/companies/'+companyB.id+'/admins','GET',
        undefined,superCookie)).status).toBe(200);
      // Empresas legadas arquivadas não podem ser editadas nem reativadas.
      // Rejeitar sem acrescentar eventos de auditoria nem mudar outros tenants.
      await db.prepare("UPDATE companies SET status='archived' WHERE id=?")
        .bind(companyB.id).run();
      const archiveEdit=await call('/api/platform/companies/'+companyB.id,'PUT',{
        name:'Tentativa em arquivada',document:'',slug:companyB.slug
      },superCookie,csrf);
      expect(archiveEdit.status).toBe(409);
      expect((await archiveEdit.json() as any).error.code).toBe('company_archived');
      expect((await call('/api/platform/companies/'+companyB.id+'/status',
        'PATCH',{status:'active'},superCookie,csrf)).status).toBe(409);
      const preservedB=await call('/api/platform/companies/'+companyB.id,'GET',
        undefined,superCookie);
      expect((await preservedB.json() as any).company).toMatchObject({
        name:'Empresa Fictícia B',status:'archived'
      });
      const events=await db.prepare(
        'SELECT action,entity_type,entity_id,details_json FROM platform_audit_log ORDER BY created_at,id'
      ).all<any>();
      const actions=events.results?.map(x=>x.action);
      expect(actions?.filter(x=>x==='company.created')).toHaveLength(2);
      expect(actions?.filter(x=>x==='company.updated')).toHaveLength(1);
      expect(actions?.filter(x=>x==='company_admin.created')).toHaveLength(4);
      expect(actions?.filter(x=>x==='company_admin.password_reset')).toHaveLength(1);
      expect(actions?.filter(x=>x==='company.status_changed')).toHaveLength(2);
      expect(JSON.stringify(events.results)).not.toContain(managerPass);
      expect(JSON.stringify(events.results)).not.toContain(managerNew);
      expect(JSON.stringify(events.results)).not.toContain(resetData.temporary_password);
      expect(JSON.stringify(events.results)).not.toContain(finalPassword);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
    }finally{
      await mf.dispose();
    }
  },120000);
});
