import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { platformCompaniesRoutes } from '../server/routes/platform-companies';
import { getPlatformSession } from '../server/routes/platform-auth';

vi.mock('../server/routes/platform-auth', () => ({
  getPlatformSession: vi.fn()
}));
vi.mock('../server/core/security', () => ({
  ipHash: () => 'test-ip',
  limit: async () => undefined
}));
vi.mock('../server/core/crypto', () => ({
  hashPassword: async () => 'safe-hash-test',
  randomToken: () => 'c'.repeat(64),
  safeEqual: (a:string,b:string) => a===b
}));

function makeApp(options:{
  companyStatus?: 'active'|'suspended'|'archived';
  otherCompany?: boolean;
  targetActive?: number;
  changed?: number;
}={}) {
  const calls:Array<{sql:string;args:unknown[]}>= [];
  const batches:Array<Array<{sql:string;args:unknown[]}>>=[];
  const companyStatus=options.companyStatus||'active';
  const db={
    prepare(sql:string){
      let args:unknown[]=[];
      const statement={
        sql,
        get args(){return args;},
        bind(...values:unknown[]){args=values;return statement;},
        async first(){
          calls.push({sql,args});
          if(sql.includes('SELECT a.id,a.active,a.auth_version,co.status AS company_status')){
            return options.otherCompany?null:{
              id:'manager-a',active:options.targetActive??1,
              auth_version:3,company_status:companyStatus
            };
          }
          if(sql.includes('SELECT a.id,a.active,co.status AS company_status')) {
            return options.otherCompany ? null : {
              id:'manager-a',active:options.targetActive??1,
              company_status:companyStatus
            };
          }
          if(sql.includes('SELECT id, status FROM companies'))return {
            id:'company-a',status:companyStatus
          };
          if(sql.includes('SELECT id FROM companies'))return {id:'company-a'};
          return null;
        },
        async all(){
          calls.push({sql,args});
          return {results:[{
            id:'manager-a',company_id:'company-a',
            login:'gestor',email:'gestor@example.com',
            display_name:'Gestor de teste',active:1,
            created_at:1760000000000,updated_at:1760000000000
          }]};
        },
        async run(){calls.push({sql,args});return {meta:{changes:1}};}
      };
      return statement;
    },
    async batch(stmts:Array<{sql:string;args:unknown[]}>){
      batches.push(stmts.map(v=>({sql:v.sql,args:v.args})));
      return stmts.map((_,i)=>({meta:{changes:i===0?(options.changed??1):1}}));
    }
  };
  const app=new Hono<App>();
  app.use('*',async(c,next)=>{
    c.set('db',db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/platform/companies',platformCompaniesRoutes);
  app.onError((err,c)=>err instanceof ApiError
    ? c.json({error:{code:err.code,message:err.message}},err.status as any)
    : c.json({error:{code:'internal_error'}},500));
  const env={AUTH_PEPPER:'p'.repeat(64),ENVIRONMENT:'development'} as any;
  function call(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:object,
    csrf='csrf-teste') {
    return app.request('/api/platform/companies'+path,{
      method,headers:{
        'Content-Type':'application/json','X-CSRF-Token':csrf
      },
      ...(body?{body:JSON.stringify(body)}:{})
    },env);
  }
  return {call,calls,batches};
}

beforeEach(()=>{
  vi.mocked(getPlatformSession).mockResolvedValue({
    id:'superadmin-teste',csrf_token:'csrf-teste'
  } as any);
});

describe('CR JORNADA — Superadmin gerencia gestores de empresas',()=>{
  it('nao devolve hash de senha ou sessao na listagem',async()=>{
    const t=makeApp();
    const r=await t.call('/company-a/admins');
    expect(r.status).toBe(200);
    const data=await r.json();
    expect(data.admins).toHaveLength(1);
    expect(data.admins[0].company_id).toBe('company-a');
    expect(JSON.stringify(data)).not.toContain('password_hash');
    expect(t.calls[1].sql).toContain('WHERE company_id = ?');
    expect(t.calls[1].args).toEqual(['company-a']);
  });

  it('nega cadastro sem sessao ou CSRF',async()=>{
    const t=makeApp();
    const body={name:'Gestor Teste',login:'gestor',email:'',
      password:'senha-de-teste-1234'};
    vi.mocked(getPlatformSession).mockResolvedValueOnce(null);
    expect((await t.call('/company-a/admins','POST',body)).status).toBe(401);
    expect((await t.call('/company-a/admins','POST',body,'outro')).status).toBe(403);
    expect(t.batches).toHaveLength(0);
  });

  it('cadastra administrador da propria empresa com senha somente hash',async()=>{
    const t=makeApp();
    const body={name:'Gestor Teste',login:'gestor',email:'',
      password:'senha-de-teste-1234'};
    const r=await t.call('/company-a/admins','POST',body);
    expect(r.status).toBe(201);
    const data=await r.json();
    expect(data.admin.company_id).toBe('company-a');
    expect(JSON.stringify(data)).not.toContain('password');
    expect(t.batches).toHaveLength(1);
    const query=t.batches[0][0];
    expect(query.sql).toContain('INSERT INTO company_admins');
    expect(query.args).toContain('company-a');
    expect(query.args).toContain('safe-hash-test');
    expect(query.args).not.toContain(body.password);
  });

  it('suspende administrador apenas se estiver na empresa indicada',async()=>{
    const foreign=makeApp({otherCompany:true});
    const r=await foreign.call('/company-a/admins/manager-b/status','PATCH',
      {active:false});
    expect(r.status).toBe(404);
    expect(foreign.batches).toHaveLength(0);
  });

  it('suspensao revoga sessoes e incrementa auth_version em transacao',async()=>{
    const t=makeApp();
    const r=await t.call('/company-a/admins/manager-a/status','PATCH',
      {active:false});
    expect(r.status).toBe(200);
    expect((await r.json()).active).toBe(false);
    expect(t.batches).toHaveLength(1);
    const [update,revoke,audit]=t.batches[0];
    expect(update.sql).toContain('auth_version=auth_version+1');
    expect(update.sql).toContain('company_id=?');
    expect(update.args).toContain('company-a');
    expect(revoke.sql).toContain('DELETE FROM company_admin_sessions');
    expect(revoke.args).toEqual(['manager-a','company-a']);
    expect(audit.sql).toContain('platform_audit_log');
    expect(audit.args.join(' ')).toContain('company-a');
  });

  it('exige CSRF para suspender, nao altera empresa arquivada',async()=>{
    const t=makeApp();
    expect((await t.call('/company-a/admins/manager-a/status','PATCH',
      {active:false},'errado')).status).toBe(403);
    const archived=makeApp({companyStatus:'archived'});
    expect((await archived.call('/company-a/admins/manager-a/status','PATCH',
      {active:false})).status).toBe(409);
    expect(archived.batches).toHaveLength(0);
  });


  it('redefinicao exige Superadmin autenticado e CSRF',async()=>{
    const t=makeApp();
    vi.mocked(getPlatformSession).mockResolvedValueOnce(null);
    expect((await t.call('/company-a/admins/manager-a/reset-password','POST'))
      .status).toBe(401);
    expect((await t.call('/company-a/admins/manager-a/reset-password','POST',
      undefined,'invalido')).status).toBe(403);
    expect(t.batches).toHaveLength(0);
  });

  it('rejeita redefinir senha de outra empresa, gestor suspenso ou empresa inativa',async()=>{
    const foreign=makeApp({otherCompany:true});
    expect((await foreign.call('/company-a/admins/manager-b/reset-password','POST'))
      .status).toBe(404);
    const suspended=makeApp({targetActive:0});
    expect((await suspended.call('/company-a/admins/manager-a/reset-password','POST'))
      .status).toBe(409);
    const blocked=makeApp({companyStatus:'suspended'});
    expect((await blocked.call('/company-a/admins/manager-a/reset-password','POST'))
      .status).toBe(409);
    expect(foreign.batches).toHaveLength(0);
    expect(suspended.batches).toHaveLength(0);
    expect(blocked.batches).toHaveLength(0);
  });

  it('gera senha provisoria unica, expira em 24h, revoga sessoes e audita sem segredo',async()=>{
    const t=makeApp();
    const before=Date.now();
    const res=await t.call('/company-a/admins/manager-a/reset-password','POST');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const result=await res.json();
    expect(result.success).toBe(true);
    expect(result.must_change_password).toBe(true);
    expect(result.temporary_password).toBe('c'.repeat(24));
    expect(result.expires_at).toBeGreaterThanOrEqual(before+24*3600000);
    expect(t.batches).toHaveLength(1);
    const [update,revoke,audit]=t.batches[0];
    expect(update.sql).toContain('must_change_password=1');
    expect(update.sql).toContain('temporary_password_expires_at=?');
    expect(update.sql).toContain('auth_version=auth_version+1');
    expect(update.args).toEqual([
      'safe-hash-test',result.expires_at,expect.any(Number),
      'manager-a','company-a',3
    ]);
    expect(revoke.sql).toContain('DELETE FROM company_admin_sessions');
    expect(revoke.args).toEqual(['manager-a','company-a']);
    expect(audit.sql).toContain('company_admin.password_reset');
    expect(audit.args.join(' ')).toContain('company-a');
    expect(JSON.stringify(t.batches)).not.toContain(result.temporary_password);
  });

  it('nao reativa administrador de empresa suspensa',async()=>{
    const t=makeApp({companyStatus:'suspended',targetActive:0});
    expect((await t.call('/company-a/admins/manager-a/status','PATCH',
      {active:true})).status).toBe(409);
    expect(t.batches).toHaveLength(0);
  });
});
