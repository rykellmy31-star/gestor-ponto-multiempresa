import { describe, expect, it } from 'vitest';
import { cpfD1Fixture } from './helpers/cpf-d1';

describe('D1 local — senha do funcionário na própria empresa',()=>{
  it('troca e revoga em conjunto, preservando outra empresa',async()=>{
    const t=await cpfD1Fixture();
    try {
      const response=await t.change();
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toContain('cr_jornada_employee_dev=');
      expect((await t.db.prepare('SELECT employee_id,company_id FROM employee_company_sessions').all()).results)
        .toEqual([{employee_id:'em-b',company_id:'co-b'}]);
      const rows=(await t.db.prepare('SELECT id,password_hash,auth_version FROM users ORDER BY id').all()).results as any[];
      expect(rows[0].auth_version).toBe(2);
      expect(rows[0].password_hash).not.toBe(t.hash);
      expect(rows[1]).toEqual({id:'user-b',password_hash:t.hash,auth_version:1});
    } finally {await t.mf.dispose();}
  });

  it('erro na revogação desfaz a senha e a versão, mantendo as sessões',async()=>{
    const t=await cpfD1Fixture();
    try {
      await t.db.prepare("CREATE TRIGGER fail_revoke BEFORE DELETE ON employee_company_sessions BEGIN SELECT RAISE(ABORT,'simulated_storage_failure'); END").run();
      expect((await t.change()).status).toBe(500);
      expect(await t.db.prepare("SELECT password_hash,auth_version FROM users WHERE id='user-a'").first())
        .toEqual({password_hash:t.hash,auth_version:1});
      expect((await t.db.prepare('SELECT * FROM employee_company_sessions').all()).results).toHaveLength(2);
    } finally {await t.mf.dispose();}
  });
});
