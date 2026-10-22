import { Hono } from 'hono';
import { z } from 'zod';
import type { App } from '../types';
import { ensure, ApiError } from '../core/errors';
import { rulesSchema } from '../core/validation';
import { DEFAULT_RULES } from '../core/calculations';
import { ipHash, limit } from '../core/security';
import { requireCompanyAdmin } from './company-auth';
import { VALID_COMPANY_ADMIN_WRITE_SQL, companyAdminWriteParams } from '../core/company-admin-write-guard';
import { companyAdminWrite } from '../core/company-admin-write';

export const companyPunchPolicyRoutes = new Hono<App>();
companyPunchPolicyRoutes.use('*',requireCompanyAdmin);
companyPunchPolicyRoutes.use('*',async(c,next)=>{
  ensure(c.env.ENABLE_COMPANY_SCHEDULES==='true',503,'company_policy_unavailable',
    'Configuração de ponto ainda em homologação.');
  ensure(Object.keys(c.req.queries()).length===0,400,'invalid_policy_query',
    'A empresa é identificada pela sessão.');
  await next();
});
const schema=z.object({enabled:z.boolean(),rules:rulesSchema.refine(r=>r.max_shift_hours<=24),
  expected_revision:z.number().int().min(0).max(2147483646)}).strict();

companyPunchPolicyRoutes.get('/',async c=>{
  const company=c.get('company')!,admin=c.get('companyAdminId')!;
  const token=c.get('companyAdminTokenHash')!,now=Date.now();
  const policy=await c.get('db').prepare(`
    SELECT pol.enabled,pol.rules_json,pol.revision,pol.updated_at
    FROM companies co LEFT JOIN company_punch_policies pol ON pol.company_id=co.id
    WHERE co.id=? AND co.status='active' AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
  `).bind(company.id,...companyAdminWriteParams(token,admin,company.id,now))
    .first<{enabled:number|null;rules_json:string|null;revision:number|null;updated_at:number|null}>();
  ensure(policy,401,'unauthenticated','Entre novamente na empresa.');
  const rules=policy.rules_json===null?DEFAULT_RULES:JSON.parse(policy.rules_json);
  ensure(rulesSchema.safeParse(rules).success && rules.max_shift_hours<=24,409,
    'invalid_company_policy','As regras existentes precisam de conferência.');
  return c.json({company_id:company.id,enabled:policy.enabled===1,rules,
    revision:policy.revision??0,updated_at:policy.updated_at});
});

companyPunchPolicyRoutes.put('/',async c=>{
  const company=c.get('company')!,admin=c.get('companyAdminId')!;
  const token=c.get('companyAdminTokenHash')!;
  await limit(c,'company-policy:'+company.id+':'+admin,30,60*60000);
  const parsed=schema.safeParse(await c.req.json().catch(()=>null));
  ensure(parsed.success,400,'invalid_company_policy','Confira os valores e a versão das regras.');
  const {enabled,rules,expected_revision:revision}=parsed.data;
  const db=c.get('db'),now=Date.now(),rulesJson=JSON.stringify(rules);
  try {
    await companyAdminWrite(db,[
      db.prepare(`
        INSERT INTO company_punch_policies(company_id,enabled,rules_json,updated_at,revision)
        SELECT co.id,?,?,?,1 FROM companies co
        WHERE co.id=? AND co.status='active' AND ${VALID_COMPANY_ADMIN_WRITE_SQL}
          AND (?=0 OR EXISTS(SELECT 1 FROM company_punch_policies p WHERE p.company_id=co.id AND p.revision=?))
        ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled,
          rules_json=excluded.rules_json,updated_at=excluded.updated_at,revision=company_punch_policies.revision+1
        WHERE company_punch_policies.revision=?
      `).bind(enabled?1:0,rulesJson,now,company.id,
        ...companyAdminWriteParams(token,admin,company.id,now),revision,revision,revision),
      db.prepare(`INSERT INTO company_punch_policy_audit
        (id,company_id,admin_id,revision,enabled,rules_json,ip_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),company.id,admin,
          revision+1,enabled?1:0,rulesJson,ipHash(c),now)
    ],'company_policy_conflict');
  } catch(error) {
    if(error instanceof ApiError && error.code==='company_policy_conflict')
      throw new ApiError(409,'company_policy_conflict',
        'As regras ou o acesso mudaram. Recarregue a configuração antes de salvar.');
    throw error;
  }
  // Somente a politica muda: dias iniciados conservam seus snapshots.
  return c.json({success:true,company_id:company.id,revision:revision+1});
});
