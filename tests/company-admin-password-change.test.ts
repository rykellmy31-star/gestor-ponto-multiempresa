import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companyAuthRoutes } from '../server/routes/company-auth';
import { companySchedulesRoutes } from '../server/routes/company-schedules';

vi.mock('../server/core/security',()=>({
  ipHash:()=> 'ip-ficticio',
  limit:async()=>undefined
}));
vi.mock('../server/core/crypto',()=>({
  hashPassword:async(s:string)=>'hash:'+s,
  verifyPassword:async(s:string,stored:string)=>'hash:'+s===stored,
  randomToken:()=> 'a'.repeat(64),
  sha256:()=> 'token-hash-teste',
  safeEqual:(a:string,b:string)=>a===b
}));

const now=Date.UTC(2026,9,19,12);
const fresh='SenhaForteNova2026';
const old='SenhaInicial2026';

function setup({mustChange=1, companyId='co-a', active=true, accountVersion=0}:{
  mustChange?:number;companyId?:string;active?:boolean;accountVersion?:number;
}={}){
  const queries:Array<{sql:string,args:unknown[]}>= [];
  const batches:Array<Array<{sql:string,args:unknown[]}>>=[];
  const db={
    prepare(sql:string){
      let args:unknown[]=[];
      const stmt={
        sql,
        get args(){return args;},
        bind(...x:unknown[]){args=x;return stmt;},
        async first(){
          queries.push({sql,args:[...args]});
          if(sql.includes('FROM company_admin_sessions s')){
            if(!active)return null;
            return {
              id:'manager-a',company_id:companyId,login:'gerente',
              display_name:'Gerente de testes',
              csrf_token:'csrf-seguro',expires_at:now+60000,
              last_seen_at:now,token_hash:'token-hash-teste',
              slug:'empresa-teste',must_change_password:mustChange
            };
          }
          if(sql.includes('SELECT password_hash, auth_version FROM company_admins')){
            return active?{password_hash:'hash:'+old,auth_version:accountVersion}:null;
          }
          if(sql.includes('FROM company_admins a')){
            return active?{id:'manager-a',company_id:companyId,
              password_hash:'hash:'+old,auth_version:accountVersion}:null;
          }
          return null;
        },
        async all(){
          queries.push({sql,args:[...args]});
          return {results:[]};
        },
        async run(){
          queries.push({sql,args:[...args]});
          return {meta:{changes:1}};
        }
      };
      return stmt;
    },
    async batch(stmts:Array<{sql:string;args:unknown[]}>){
      batches.push(stmts.map(s=>({sql:s.sql,args:s.args})));
      return stmts.map(()=>({meta:{changes:1}}));
    }
  };
  const app=new Hono<App>();
  app.use('*',async(c,next)=>{
    c.set('db',db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/company/auth',companyAuthRoutes);
  app.route('/api/company/schedules',companySchedulesRoutes);
  app.onError((err,c)=>err instanceof ApiError
    ?c.json({error:{code:err.code,message:err.message}},err.status as any)
    :c.json({error:{code:'internal_error'}},500));
  const env={ENVIRONMENT:'development',AUTH_PEPPER:'pepper-local',
    ENABLE_COMPANY_SCHEDULES:'true'} as any;
  function request(path:string,method:'GET'|'POST'='GET',body?:object,
    csrf='csrf-seguro',cookie=true){
    return app.request(path,{
      method,
      headers:{
        ...(cookie?{'Cookie':'cr_jornada_company_dev='+'a'.repeat(64)}:{}),
        ...(method==='POST'?{
          'Content-Type':'application/json',
          'X-CSRF-Token':csrf
        }:{})
      },
      ...(body?{body:JSON.stringify(body)}:{})
    },env);
  }
  return {request,batches,queries};
}

beforeEach(()=>vi.spyOn(Date,'now').mockReturnValue(now));

describe('CR JORNADA — troca obrigatoria de senha do gestor da empresa',()=>{
  it('sessao revela apenas a necessidade de trocar senha, sem hash',async()=>{
    const t=setup();
    const res=await t.request('/api/company/auth/session');
    expect(res.status).toBe(200);
    const data=await res.json();
    expect(data.must_change_password).toBe(true);
    expect(JSON.stringify(data)).not.toContain('password_hash');
    expect(JSON.stringify(data)).not.toContain('token_hash');
  });

  it('nega ate a leitura de jornadas enquanto senha e inicial',async()=>{
    const t=setup();
    const res=await t.request('/api/company/schedules');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('password_change_required');
    expect(t.queries.some(q=>q.sql.includes('FROM schedules'))).toBe(false);
  });

  it('continua exigindo autenticação valida',async()=>{
    const t=setup();
    const res=await t.request('/api/company/auth/change-password','POST',{
      current_password:old,new_password:fresh
    },'csrf-seguro',false);
    expect(res.status).toBe(401);
    expect(t.batches).toHaveLength(0);
  });

  it('exige CSRF e rejeita senha inicial incorreta',async()=>{
    const t=setup();
    const wrongCsrf=await t.request('/api/company/auth/change-password','POST',{
      current_password:old,new_password:fresh
    },'outro');
    expect(wrongCsrf.status).toBe(403);
    const wrongPassword=await t.request('/api/company/auth/change-password','POST',{
      current_password:'OutraSenhaInicial',new_password:fresh
    });
    expect(wrongPassword.status).toBe(401);
    expect(t.batches).toHaveLength(0);
  });

  it('recusa repetir senha inicial ou criar senha curta',async()=>{
    const t=setup();
    for(const data of [
      {current_password:old,new_password:old},
      {current_password:old,new_password:'curta'}
    ]){
      const res=await t.request('/api/company/auth/change-password','POST',data);
      expect(res.status).toBe(400);
    }
    expect(t.batches).toHaveLength(0);
  });

  it('atualiza apenas o gestor e empresa da sessao e revoga suas sessoes',async()=>{
    const t=setup();
    const res=await t.request('/api/company/auth/change-password','POST',{
      current_password:old,new_password:fresh
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({success:true,requires_login:true});
    expect(res.headers.get('set-cookie')).toContain('cr_jornada_company_dev=');
    expect(t.batches).toHaveLength(1);
    const [update,revoke,audit]=t.batches[0];
    expect(update.sql).toContain('must_change_password=0');
    expect(update.sql).toContain('auth_version=auth_version+1');
    expect(update.sql).toContain('WHERE id=? AND company_id=?');
    expect(update.args).toEqual(['hash:'+fresh,now,'manager-a','co-a',0]);
    expect(revoke.sql).toContain('DELETE FROM company_admin_sessions');
    expect(revoke.args).toEqual(['manager-a','co-a']);
    expect(audit.sql).toContain('company_admin_security_events');
    expect(audit.args).toContain('co-a');
    expect(JSON.stringify(t.batches)).not.toContain(old);
    expect(update.args[0]).toBe('hash:'+fresh); // mock substitui o hash real
  });

  it('nao modifica a empresa de outra sessao',async()=>{
    const t=setup({companyId:'co-b'});
    const res=await t.request('/api/company/auth/change-password','POST',{
      current_password:old,new_password:fresh
    });
    expect(res.status).toBe(200);
    expect(t.batches[0][0].args).toContain('co-b');
    expect(t.batches[0][1].args).toContain('co-b');
    expect(t.batches[0][0].args).not.toContain('co-a');
  });

  it('gestor com senha atualizada pode listar jornadas de sua empresa',async()=>{
    const t=setup({mustChange:0});
    const res=await t.request('/api/company/schedules');
    expect(res.status).toBe(200);
  });
});
