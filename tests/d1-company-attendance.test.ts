import { describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import server from '../server/index';
import { csvCell } from '../server/routes/company-attendance';
import { sha256 } from '../server/core/crypto';

describe('relatorio empresarial mensal — D1 local e roteador real',()=>{
  it('isola empresas, valida filtros, exporta CSV seguro e revoga acessos',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,
      script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']}]}));
    try {
      const binding=await mf.getD1Database('DB');
      const db=binding.withSession();
      const now=Date.now(),tokenA='a'.repeat(64),tokenB='b'.repeat(64);
      await db.batch([
        db.prepare('CREATE TABLE companies(id TEXT PRIMARY KEY,slug TEXT,status TEXT)'),
        db.prepare('CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,display_name TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER)'),
        db.prepare('CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,company_id TEXT,csrf_token TEXT,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE employees(id TEXT PRIMARY KEY,company_id TEXT,full_name TEXT,registration TEXT,company_registration TEXT,deleted_at INTEGER)'),
        db.prepare('CREATE TABLE work_days(id TEXT PRIMARY KEY,company_id TEXT,employee_id TEXT,work_date TEXT,timezone TEXT,next_seq INTEGER)'),
        db.prepare('CREATE TABLE punches(id TEXT PRIMARY KEY,work_day_id TEXT,employee_id TEXT,seq INTEGER,type TEXT,recorded_at INTEGER,receipt_hash TEXT)'),
        db.prepare("INSERT INTO companies VALUES('a','empresa-a','active'),('b','empresa-b','active')"),
        db.prepare("INSERT INTO company_admins VALUES('admin-a','a','gestor','Gestor A',1,1,0,NULL),('admin-b','b','gestor','Gestor B',1,1,0,NULL)"),
        db.prepare("INSERT INTO company_admin_sessions VALUES(?, 'admin-a','a','csrf',?,?,1),(?,'admin-b','b','csrf',?,?,1)")
          .bind(sha256(tokenA),now+600000,now,sha256(tokenB),now+600000,now),
        db.prepare("INSERT INTO employees VALUES('em-a','a','=Nome;\"QA\"','technical-a','001',NULL),('em-b','b','Pessoa B','technical-b','001',NULL)"),
        db.prepare("INSERT INTO work_days VALUES('da','a','em-a','2026-10-21','America/Bahia',1),('db','b','em-b','2026-10-21','America/Bahia',1),('old','a','em-a','2026-09-30','America/Bahia',1),('legacy',NULL,'em-a','2026-10-20','America/Bahia',1)"),
        db.prepare("INSERT INTO punches VALUES('pa','da','em-a',0,'entry',1792591200000,'receipt-a'),('pb','db','em-b',0,'entry',1792591200000,'secret-b'),('forged','da','em-b',1,'break_start',1792591200000,'forged-other-employee')")
      ]);
      const env={DB:binding,ENVIRONMENT:'development',AUTH_PEPPER:'test-pepper'.repeat(5),
        DATA_KEY:'a'.repeat(64),ENABLE_COMPANY_SCHEDULES:'true',ASSETS:{fetch:()=>new Response('asset')}} as any;
      const call=(query='employee_id=em-a&month=2026-10',token=tokenA,method='GET')=>
        server.request('/api/company/reports/attendance?'+query,{
          method,headers:{Cookie:'cr_jornada_company_dev='+token,Origin:'http://localhost'}
        },env);
      const response=await call();
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      const result=await response.json() as any;
      expect(result.company_id).toBe('a');
      expect(result.employee.registration).toBe('001');
      expect(result.rows.map((r:any)=>r.punch_id)).toEqual(['pa']);
      expect(JSON.stringify(result)).not.toMatch(/secret-b|technical-a|forged-other/);
      expect((await call('employee_id=em-b&month=2026-10')).status).toBe(404);
      expect((await call(undefined,tokenB)).status).toBe(404);
      expect((await call('employee_id=em-b&month=2026-10',tokenB)).status).toBe(200);
      for(const query of ['employee_id=em-a&month=2026-13','employee_id=em-a&month=2026-1',
        'employee_id=em-a&month=2026-10&company_id=b','employee_id=em-a&employee_id=em-b&month=2026-10',
        'employee_id=em-a&month=2026-10&format=html',"employee_id=' OR 1=1 --&month=2026-10"]){
        expect([400,404]).toContain((await call(query)).status);
      }
      const empty=await (await call('employee_id=em-a&month=2026-11')).json() as any;
      expect(empty.rows).toEqual([]);
      const csv=await call('employee_id=em-a&month=2026-10&format=csv');
      expect(csv.headers.get('Content-Type')).toContain('text/csv');
      expect(csv.headers.get('Content-Disposition')).toContain('marcacoes-2026-10.csv');
      const text=await csv.text();
      expect(text).toContain('"\'=Nome;""QA""";"001"');
      expect(text).toContain('receipt-a');
      expect(text).not.toMatch(/secret-b|technical-a|forged-other/);
      expect((await call(undefined,'c'.repeat(64))).status).toBe(401);
      expect((await call(undefined,tokenA,'POST')).status).toBe(503);
      env.ENABLE_COMPANY_SCHEDULES='false';
      expect((await call()).status).toBe(503);
      env.ENABLE_COMPANY_SCHEDULES='true';
      await db.prepare("UPDATE company_admins SET must_change_password=1 WHERE id='admin-a'").run();
      expect((await call()).status).toBe(403);
      await db.prepare("UPDATE company_admins SET must_change_password=0,auth_version=2 WHERE id='admin-a'").run();
      expect((await call()).status).toBe(401);
      await db.prepare("UPDATE company_admins SET auth_version=1 WHERE id='admin-a'").run();
      // Suspension after middleware/employee lookup, before the marks query.
      // A second SQL authorization check must prevent even one receipt leaking.
      env.DB={withSession:()=>({prepare(sql:string){
        const statement=db.prepare(sql);
        if(!sql.includes('FROM work_days d'))return statement;
        let bound=statement;
        return {
          bind(...values:any[]){bound=statement.bind(...values);return this;},
          async all(){
            await db.prepare("UPDATE companies SET status='suspended' WHERE id='a'").run();
            return bound.all();
          }
        };
      }})};
      const raced=await (await call()).json() as any;
      expect(raced.rows).toEqual([]);
      expect(JSON.stringify(raced)).not.toContain('receipt-a');
      env.DB=binding;
      await db.prepare("UPDATE companies SET status='suspended' WHERE id='a'").run();
      expect((await call()).status).toBe(401);
      expect((await call('employee_id=em-b&month=2026-10',tokenB)).status).toBe(200);
    } finally {await mf.dispose();}
  },60000);
  it('neutraliza formulas mesmo com espaços e mantém aspas e quebras de linha',()=>{
    for(const text of ['=1+1',' +cmd','-1','@SUM(A1)','\tformula','\rformula','\nformula'])
      expect(csvCell(text).startsWith('"\'')).toBe(true);
    expect(csvCell('Nome "QA";teste\nlinha')).toBe('"Nome ""QA"";teste\nlinha"');
  });
});
