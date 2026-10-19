import { describe, expect, it } from 'vitest';
import { cpfD1Fixture } from './helpers/cpf-d1';
import { verifyPassword, sha256 } from '../server/core/crypto';

async function reset(t:Awaited<ReturnType<typeof cpfD1Fixture>>, employee='em-a',
  options:{enabled?:boolean;csrf?:string;cookie?:boolean;password?:string}={}) {
  return t.app.request('/company/employees/'+employee+'/reset-password',{
    method:'POST',headers:{'Content-Type':'application/json',
      'X-CSRF-Token':options.csrf??'manager-csrf',
      ...(options.cookie===false?{}:{cookie:'cr_jornada_company_dev='+'c'.repeat(64)})},
    body:JSON.stringify({current_password:options.password??t.password})
  },{...t.env,ENABLE_EMPLOYEE_PASSWORD_RECOVERY:options.enabled===false?undefined:'true'});
}

function login(t:Awaited<ReturnType<typeof cpfD1Fixture>>,password:string) {
  return t.app.request('/auth/login',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({cpf:'529.982.247-25',password})},t.env);
}

describe('D1 local — recuperação de funcionário sem cruzar empresas',()=>{
  it('exige ativação explícita, sessão, CSRF e senha atual do gestor',async()=>{
    const t=await cpfD1Fixture();
    try {
      expect((await reset(t,'em-a',{enabled:false})).status).toBe(503);
      expect((await reset(t,'em-a',{cookie:false})).status).toBe(401);
      expect((await reset(t,'em-a',{csrf:'wrong'})).status).toBe(403);
      expect((await reset(t,'em-a',{password:'wrong'})).status).toBe(401);
      const injected=await t.app.request('/company/employees/em-a/reset-password',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':'manager-csrf',
          cookie:'cr_jornada_company_dev='+'c'.repeat(64)},
        body:JSON.stringify({current_password:t.password,company_id:'co-b'})
      },{...t.env,ENABLE_EMPLOYEE_PASSWORD_RECOVERY:'true'});
      expect(injected.status).toBe(400);
      expect((await t.db.prepare('SELECT * FROM company_employee_security_events').all()).results).toEqual([]);
      expect((await t.db.prepare('SELECT * FROM employee_company_sessions').all()).results).toHaveLength(2);
    } finally {await t.mf.dispose();}
  },30000);

  it('nega alvo de outra empresa e conta bloqueada',async()=>{
    const t=await cpfD1Fixture();
    try {
      expect((await reset(t,'em-b')).status).toBe(404);
      await t.db.prepare("UPDATE employees SET status='blocked' WHERE id='em-a'").run();
      expect((await reset(t)).status).toBe(404);
      expect((await t.db.prepare('SELECT * FROM company_employee_security_events').all()).results).toEqual([]);
    } finally {await t.mf.dispose();}
  },30000);

  it('revoga só A, força troca e preserva B com o mesmo CPF',async()=>{
    const t=await cpfD1Fixture();
    try {
      const response=await reset(t);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const data=await response.json() as any;
      expect(data.temporary_password).toMatch(/^[a-f0-9]{24}$/);
      expect(data.expires_at).toBeGreaterThanOrEqual(t.now+24*3600000);
      expect((await t.db.prepare('SELECT company_id FROM employee_company_sessions').all()).results)
        .toEqual([{company_id:'co-b'}]);
      const user=await t.db.prepare("SELECT password_hash,must_change_password,employee_temporary_password_expires_at,auth_version FROM users WHERE id='user-a'").first() as any;
      expect(user.must_change_password).toBe(1);
      expect(user.auth_version).toBe(2);
      expect(await verifyPassword(data.temporary_password,user.password_hash,t.env.AUTH_PEPPER)).toBe(true);
      const audit=(await t.db.prepare('SELECT * FROM company_employee_security_events').all()).results;
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(data.temporary_password);
      expect(await t.db.prepare("SELECT password_hash,auth_version FROM users WHERE id='user-b'").first())
        .toEqual({password_hash:t.hash,auth_version:1});
      const logged=await login(t,data.temporary_password);
      expect(logged.status).toBe(200);
      const cookie=logged.headers.get('set-cookie')!.split(';')[0];
      const sessionResponse=await t.app.request('/auth/session',{headers:{cookie}},t.env);
      const session=await sessionResponse.json() as any;
      expect(session.company.id).toBe('co-a');
      expect(session.user.must_change_password).toBe(true);
      const changed=await t.app.request('/auth/password',{method:'POST',headers:{cookie,
        'Content-Type':'application/json','X-CSRF-Token':session.csrf_token},
        body:JSON.stringify({current_password:data.temporary_password,new_password:'NovaSenhaDefinitiva2026'})},t.env);
      expect(changed.status).toBe(200);
      expect(await t.db.prepare("SELECT must_change_password,employee_temporary_password_expires_at FROM users WHERE id='user-a'").first())
        .toEqual({must_change_password:0,employee_temporary_password_expires_at:null});
      expect((await t.app.request('/auth/session',{headers:{cookie}},t.env)).status).toBe(401);
      expect((await login(t,data.temporary_password)).status).toBe(401);
      expect((await login(t,'NovaSenhaDefinitiva2026')).status).toBe(200);
    } finally {await t.mf.dispose();}
  },30000);

  it('senha provisória vencida bloqueia login e sessão emitida antes do prazo',async()=>{
    const t=await cpfD1Fixture();
    try {
      const response=await reset(t),data=await response.json() as any;
      const logged=await login(t,data.temporary_password);
      expect(logged.status).toBe(200);
      const cookie=logged.headers.get('set-cookie')!.split(';')[0];
      const challenge='d'.repeat(64);
      await t.db.prepare('INSERT INTO employee_login_challenges VALUES (?,?,?,?,NULL,NULL)')
        .bind(sha256(challenge),JSON.stringify([{user_id:'user-a',employee_id:'em-a',company_id:'co-a',auth_version:2}]),
          t.now,t.now+300000).run();
      await t.db.prepare("UPDATE users SET employee_temporary_password_expires_at=1 WHERE id='user-a'").run();
      const selected=await t.app.request('/auth/select',{method:'POST',headers:{'Content-Type':'application/json',
        cookie:'cr_jornada_employee_choice_dev='+challenge},body:JSON.stringify({company_id:'co-a'})},t.env);
      expect(selected.status).toBe(401);
      expect(selected.headers.get('set-cookie')).toBeNull();
      expect((await login(t,data.temporary_password)).status).toBe(401);
      expect((await t.app.request('/auth/session',{headers:{cookie}},t.env)).status).toBe(401);
    } finally {await t.mf.dispose();}
  },30000);

  it('revalida gestor, sessão e empresa na transação de recuperação',async()=>{
    for(const mutation of [
      "DELETE FROM company_admin_sessions WHERE admin_id='manager-a'",
      "UPDATE company_admins SET active=0 WHERE id='manager-a'",
      "UPDATE companies SET status='suspended' WHERE id='co-a'",
      "UPDATE users SET active=0 WHERE id='user-a'"
    ]) {
      const t=await cpfD1Fixture();
      try {
        t.hooks.beforeBatch=async()=>{await t.db.prepare(mutation).run();};
        const response=await reset(t);
        expect(response.status,mutation).toBe(409);
        expect((await t.db.prepare('SELECT * FROM company_employee_security_events').all()).results).toEqual([]);
        expect(await t.db.prepare("SELECT password_hash,employee_temporary_password_expires_at FROM users WHERE id='user-a'").first())
          .toEqual({password_hash:t.hash,employee_temporary_password_expires_at:null});
        expect((await t.db.prepare('SELECT * FROM employee_company_sessions').all()).results).toHaveLength(2);
      } finally {await t.mf.dispose();}
    }
  },30000);

  it('banco rejeita eventos cruzados, alteração de auditoria e prazo sem troca obrigatória',async()=>{
    const t=await cpfD1Fixture();
    try {
      await expect(t.db.prepare("INSERT INTO company_employee_security_events VALUES ('cross','co-b','em-b','user-b','manager-a','password_reset',1)").run()).rejects.toThrow(/employee_security_admin_mismatch/);
      await expect(t.db.prepare("INSERT INTO company_employee_security_events VALUES ('cross','co-b','em-a','user-a',NULL,'password_changed',1)").run()).rejects.toThrow();
      expect((await reset(t)).status).toBe(200);
      await expect(t.db.prepare('UPDATE company_employee_security_events SET created_at=1').run()).rejects.toThrow(/immutable/);
      await expect(t.db.prepare('DELETE FROM company_employee_security_events').run()).rejects.toThrow(/immutable/);
      await expect(t.db.prepare("UPDATE users SET must_change_password=0 WHERE id='user-a'").run()).rejects.toThrow();
    } finally {await t.mf.dispose();}
  },30000);

  it('falha na auditoria reverte senha, prazo e revogação',async()=>{
    const t=await cpfD1Fixture();
    try {
      await t.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON company_employee_security_events BEGIN SELECT RAISE(ABORT,'simulated_storage_failure'); END").run();
      expect((await reset(t)).status).toBe(500);
      expect(await t.db.prepare("SELECT password_hash,auth_version,employee_temporary_password_expires_at FROM users WHERE id='user-a'").first())
        .toEqual({password_hash:t.hash,auth_version:1,employee_temporary_password_expires_at:null});
      expect((await t.db.prepare('SELECT * FROM employee_company_sessions').all()).results).toHaveLength(2);
    } finally {await t.mf.dispose();}
  },30000);
});
