import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { App } from '../../server/types';
import { ApiError } from '../../server/core/errors';
import { hashPassword, sha256 } from '../../server/core/crypto';
import { companyEmployeesRoutes } from '../../server/routes/company-employees';
import { employeeCpfLookupKey } from '../../server/core/employee-cpf';
import { employeeCpfAuthRoutes } from '../../server/routes/employee-cpf-auth';

// Banco efêmero: nenhum binding remoto e nenhum arquivo de dados real.
export async function cpfD1Fixture() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules:true, script:'export default {fetch(){return new Response("local")}}',
    d1Databases:['DB']
  }));
  const db=(await mf.getD1Database('DB')).withSession() as unknown as D1DatabaseSession;
  const now=Date.now(), token='a'.repeat(64), pepper='local-only-test-pepper';
  const password='SenhaOriginal2026';
  const hash=await hashPassword(password,pepper);
  const queries=[
    'CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT,slug TEXT,timezone TEXT,status TEXT)',
    'CREATE TABLE employees(id TEXT PRIMARY KEY,company_id TEXT,full_name TEXT,registration TEXT,status TEXT,deleted_at INTEGER,job_title TEXT,admission_date TEXT,employment_end TEXT,cpf_last4 TEXT,UNIQUE(id,company_id))',
    'CREATE TABLE users(id TEXT PRIMARY KEY,employee_id TEXT UNIQUE,display_name TEXT,role TEXT,active INTEGER,must_change_password INTEGER,password_hash TEXT,auth_version INTEGER,updated_at INTEGER,UNIQUE(id,employee_id))',
    'CREATE TABLE employee_cpf_links(employee_id TEXT PRIMARY KEY,company_id TEXT,cpf_lookup_key TEXT)',
    'CREATE TABLE employee_company_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,employee_id TEXT,company_id TEXT,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)',
    'CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,display_name TEXT,password_hash TEXT,active INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER,auth_version INTEGER)',
    'CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,company_id TEXT,admin_id TEXT,csrf_token TEXT,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)',
    'CREATE TABLE employee_login_challenges(token_hash TEXT PRIMARY KEY,choices_json TEXT,created_at INTEGER,expires_at INTEGER,used_at INTEGER,consumed_nonce TEXT)',
    'CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)',
    readFileSync('migrations/0026_company_admin_atomic_writes.sql','utf8'),
    readFileSync('migrations/0002_auth_versions.sql','utf8').match(/CREATE TRIGGER users_auth_version[\s\S]*?END;/)![0],
    "INSERT INTO companies VALUES ('co-a','Empresa A','empresa-a','America/Bahia','active'),('co-b','Empresa B','empresa-b','America/Bahia','active')",
    "INSERT INTO employees(id,company_id,full_name,registration,status,deleted_at) VALUES ('em-a','co-a','Pessoa A','100','active',NULL),('em-b','co-b','Pessoa B','200','active',NULL)",
    "INSERT INTO employee_cpf_links VALUES ('em-a','co-a','key'),('em-b','co-b','key')"
  ];
  await db.batch(queries.map(sql=>db.prepare(sql)));
  const migration=readFileSync('migrations/0027_employee_password_recovery.sql','utf8');
  await db.batch(migration.split(/;(?=\r?\n|$)/).filter(sql=>sql.trim()).map(sql=>db.prepare(sql)));
  const lookup=employeeCpfLookupKey('529.982.247-25','local-test-lookup-secret-32-characters');
  await db.prepare('UPDATE employee_cpf_links SET cpf_lookup_key=?').bind(lookup).run();
  await db.prepare("INSERT INTO company_admins VALUES ('manager-a','co-a','gestor','Gestor A',?,1,0,NULL,0)").bind(hash).run();
  await db.prepare("INSERT INTO company_admin_sessions VALUES (?,'co-a','manager-a','manager-csrf',?,?,0)")
    .bind(sha256('c'.repeat(64)),now+3600000,now).run();
  for(const suffix of ['a','b']) {
    await db.prepare('INSERT INTO users(id,employee_id,display_name,role,active,must_change_password,password_hash,auth_version,updated_at) VALUES (?,?,?,\'employee\',1,0,?,1,?)')
      .bind('user-'+suffix,'em-'+suffix,'Pessoa '+suffix,hash,now).run();
    await db.prepare('INSERT INTO employee_company_sessions VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(sha256(suffix==='a'?token:'b'.repeat(64)),'user-'+suffix,'em-'+suffix,
        'co-'+suffix,'csrf',now,now+3600000,now,1).run();
  }
  const app=new Hono<App>();
  const hooks={beforeBatch:undefined as undefined|(()=>Promise<void>)};
  const routedDb={
    prepare:(sql:string)=>db.prepare(sql),
    async batch(statements:D1PreparedStatement[]) {
      const hook=hooks.beforeBatch;hooks.beforeBatch=undefined;
      if(hook)await hook();
      return db.batch(statements);
    }
  };
  app.use('*',async(c,next)=>{c.set('db',routedDb as D1DatabaseSession);await next();});
  app.route('/auth',employeeCpfAuthRoutes);
  app.route('/company/employees',companyEmployeesRoutes);
  app.onError((e,c)=>e instanceof ApiError
    ?c.json({error:{code:e.code}},e.status as any):c.json({error:{code:'internal'}},500));
  const env={ENVIRONMENT:'development',AUTH_PEPPER:pepper,
    CPF_LOOKUP_SECRET:'local-test-lookup-secret-32-characters'} as any;
  const change=()=>app.request('/auth/password',{
    method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':'csrf',
      cookie:'cr_jornada_employee_dev='+token},
    body:JSON.stringify({current_password:password,new_password:'SenhaAtualizada2026'})
  },env);
  return {mf,db,app,env,now,token,password,hash,change,hooks};
}
