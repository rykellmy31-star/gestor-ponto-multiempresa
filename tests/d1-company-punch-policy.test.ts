import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import server from '../server/index';
import { sha256 } from '../server/core/crypto';
import { DEFAULT_RULES } from '../server/core/calculations';

describe('politica empresarial de ponto — D1 e roteador real',()=>{
  it('isola empresas, registra auditoria atomica, bloqueia conflitos e preserva snapshots',async()=>{
    const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,
      script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']}]}));
    try {
      const binding=await mf.getD1Database('DB'),db=binding.withSession();
      const now=Date.now(),a='a'.repeat(64),b='b'.repeat(64),rules=JSON.stringify(DEFAULT_RULES);
      await db.batch([
        db.prepare('CREATE TABLE companies(id TEXT PRIMARY KEY,slug TEXT,status TEXT)'),
        db.prepare('CREATE TABLE company_admins(id TEXT PRIMARY KEY,company_id TEXT,login TEXT,display_name TEXT,active INTEGER,auth_version INTEGER,must_change_password INTEGER,temporary_password_expires_at INTEGER)'),
        db.prepare('CREATE TABLE company_admin_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT,company_id TEXT,csrf_token TEXT,expires_at INTEGER,last_seen_at INTEGER,auth_version INTEGER)'),
        db.prepare('CREATE TABLE company_punch_policies(company_id TEXT PRIMARY KEY REFERENCES companies(id),enabled INTEGER,rules_json TEXT,updated_at INTEGER)'),
        db.prepare('CREATE TABLE company_admin_write_guards(id TEXT PRIMARY KEY,affected_rows INTEGER CONSTRAINT company_admin_write_conflict CHECK(affected_rows=1))'),
        db.prepare('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER)'),
        db.prepare('CREATE TABLE work_days(id TEXT PRIMARY KEY,company_id TEXT,rules_json TEXT,next_seq INTEGER)'),
        db.prepare("INSERT INTO companies VALUES('a','empresa-a','active'),('b','empresa-b','active')"),
        db.prepare("INSERT INTO company_admins VALUES('aa','a','gestor','A',1,1,0,NULL),('ab','b','gestor','B',1,1,0,NULL)"),
        db.prepare("INSERT INTO company_admin_sessions VALUES(?,'aa','a','csrf',?,?,1),(?,'ab','b','csrf',?,?,1)")
          .bind(sha256(a),now+600000,now,sha256(b),now+600000,now),
        db.prepare("INSERT INTO company_punch_policies VALUES('b',1,?,?)").bind(rules,now),
        db.prepare("INSERT INTO work_days VALUES('started-a','a',?,1)").bind(rules)
      ]);
      const sql=readFileSync('migrations/0039_company_punch_policy_audit.sql','utf8').replace(/^--.*$/gm,'');
      const statements=sql.match(/ALTER TABLE[\s\S]*?;|CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\nBEGIN[\s\S]*?END;/g)!;
      expect(statements).toHaveLength(6);
      await db.batch(statements.map(s=>db.prepare(s)));
      expect((await db.prepare("SELECT revision,rules_json FROM company_punch_policies WHERE company_id='b'").first()) as any)
        .toEqual({revision:1,rules_json:rules});
      const env={DB:binding,ENVIRONMENT:'development',AUTH_PEPPER:'test-policy-pepper'.repeat(3),
        DATA_KEY:'a'.repeat(64),ENABLE_COMPANY_SCHEDULES:'true'} as any;
      const call=(token=a,body?:object,csrf='csrf',suffix='')=>server.request('/api/company/punch-policy'+suffix,{
        method:body?'PUT':'GET',headers:{Cookie:'cr_jornada_company_dev='+token,Origin:'http://localhost',
          'Content-Type':'application/json','X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})
      },env);
      const payload={enabled:true,rules:DEFAULT_RULES,expected_revision:0};
      const initial=await (await call()).json() as any;
      expect(initial).toMatchObject({company_id:'a',revision:0,enabled:false,rules:DEFAULT_RULES});
      expect((await call('c'.repeat(64))).status).toBe(401);
      expect((await call(a,payload,'wrong')).status).toBe(403);
      expect((await call(a,undefined,'csrf','?company_id=b')).status).toBe(400);
      expect((await call(a,{...payload,company_id:'b'})).status).toBe(400);
      expect((await call(a,{...payload,rules:{...DEFAULT_RULES,max_shift_hours:36}})).status).toBe(400);
      expect((await call(a,payload)).status).toBe(200);
      expect((await call(a,payload)).status).toBe(409);
      expect((await (await call(b)).json() as any)).toMatchObject({company_id:'b',revision:1,enabled:true});
      const concurrent=await Promise.all([
        call(a,{...payload,expected_revision:1,rules:{...DEFAULT_RULES,mark_tolerance:6}}),
        call(a,{...payload,expected_revision:1,rules:{...DEFAULT_RULES,mark_tolerance:7}})
      ]);
      expect(concurrent.map(r=>r.status).sort()).toEqual([200,409]);
      expect((await db.prepare('SELECT COUNT(*) n FROM company_punch_policy_audit').first() as any).n).toBe(2);
      expect((await db.prepare("SELECT rules_json FROM work_days WHERE id='started-a'").first() as any).rules_json).toBe(rules);
      // Audit failure must roll the policy change back, including its revision.
      await db.prepare("CREATE TRIGGER fail_policy_audit BEFORE INSERT ON company_punch_policy_audit WHEN NEW.revision=3 BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END").run();
      expect((await call(a,{...payload,expected_revision:2,enabled:false})).status).toBe(500);
      expect((await (await call()).json() as any)).toMatchObject({revision:2,enabled:true});
      await db.prepare('DROP TRIGGER fail_policy_audit').run();
      expect((await call(a,{...payload,expected_revision:2,enabled:false})).status).toBe(200);
      const audit=await db.prepare("SELECT * FROM company_punch_policy_audit WHERE company_id='a' ORDER BY revision").all<any>();
      expect(audit.results.map(row=>row.revision)).toEqual([1,2,3]);
      const rejected=async(sql:string)=>expect(db.prepare(sql).run()).rejects.toThrow();
      await rejected("UPDATE company_punch_policy_audit SET enabled=0");
      await rejected("DELETE FROM company_punch_policy_audit");
      await rejected("INSERT OR REPLACE INTO company_punch_policy_audit SELECT * FROM company_punch_policy_audit LIMIT 1");
      await rejected("INSERT INTO company_punch_policy_audit VALUES('cross','b','aa',2,1,'{}','ip',1)");
      // Revoke the session after middleware, before the optimistic SQL write.
      env.DB={withSession:()=>({prepare:(sql:string)=>db.prepare(sql),
        async batch(statements:any[]){
          await db.prepare("UPDATE company_admins SET auth_version=2 WHERE id='aa'").run();
          return db.batch(statements);
        }
      })};
      expect((await call(a,{...payload,expected_revision:3})).status).toBe(409);
      env.DB=binding;
      expect((await call()).status).toBe(401);
      expect((await db.prepare("SELECT revision,enabled FROM company_punch_policies WHERE company_id='a'").first()) as any)
        .toEqual({revision:3,enabled:0});
      expect((await db.prepare("SELECT COUNT(*) n FROM company_punch_policy_audit WHERE company_id='a'").first() as any).n).toBe(3);
      expect((await call(b)).status).toBe(200);
      env.ENABLE_COMPANY_SCHEDULES='false';
      expect((await call(b)).status).toBe(503);
    } finally {await mf.dispose();}
  },60000);
});
