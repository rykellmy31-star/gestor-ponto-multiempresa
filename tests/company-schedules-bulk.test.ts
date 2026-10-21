import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { companySchedulesRoutes } from '../server/routes/company-schedules';

vi.mock('../server/core/security',()=>({
  ipHash:()=> 'test-ip',limit:async()=>undefined
}));
vi.mock('../server/core/crypto',()=>({
  sha256:()=> 'a'.repeat(64),safeEqual:(a:string,b:string)=>a===b
}));

type Variant='normal'|'already'|'conflict'|'no-staff'|'bad-schedule'|'overflow'|'revoked';
function setup(variant:Variant='normal'){
  const sqls:Array<{sql:string;params:unknown[]}>=[];
  const batches:Array<Array<{sql:string;params:unknown[]}>>=[];
  const db={
    prepare(sql:string){
      let params:unknown[]=[];
      const statement={
        sql,get params(){return [...params];},
        bind(...args:unknown[]){params=args;return statement;},
        async first(){
          sqls.push({sql,params:[...params]});
          if(sql.includes('FROM company_admin_sessions s'))return {
            id:'admin-a',company_id:'company-a',slug:'empresa-a',csrf_token:'csrf-a',
            token_hash:'a'.repeat(64),must_change_password:0,
            expires_at:Date.now()+60000,last_seen_at:Date.now()
          };
          if(sql.includes('SELECT s.id FROM schedules s'))return variant==='bad-schedule'
            ?null:{id:'schedule-a'};
          return null;
        },
        async all(){
          sqls.push({sql,params:[...params]});
          if(!sql.includes('FROM employees e JOIN companies co'))return {results:[]};
          if(variant==='no-staff')return {results:[]};
          if(variant==='overflow')return {results:Array.from({length:201},(_,i)=>({
            id:'employee-'+i,existing_schedule_id:null
          }))};
          return {results:[
            {id:'employee-a',existing_schedule_id:variant==='already'
              ?'schedule-a':null},
            {id:'employee-b',existing_schedule_id:variant==='conflict'
              ?'schedule-b':variant==='already'?'schedule-a':null}
          ]};
        }
      };
      return statement;
    },
    async batch(statements:Array<{sql:string;params:unknown[]}>){
      batches.push(statements);
      if(variant==='revoked')throw new Error('company_employee_write_conflict');
      return statements.map(()=>({meta:{changes:1}}));
    }
  };
  const app=new Hono<App>();
  app.use('*',async(c,next)=>{c.set('db',db as unknown as D1DatabaseSession);await next()});
  app.route('/api/company/schedules',companySchedulesRoutes);
  app.onError((e,c)=>e instanceof ApiError
    ?c.json({error:{code:e.code}},e.status as any)
    :c.json({error:{code:'internal_error'}},500));
  const send=(body:object={},opts:{csrf?:string;flag?:string}={})=>app.request(
    '/api/company/schedules/schedule-a/assign-all',{
      method:'POST',headers:{
        Cookie:'cr_jornada_company_dev='+'a'.repeat(64),
        'Content-Type':'application/json',
        'X-CSRF-Token':opts.csrf===undefined?'csrf-a':opts.csrf
      },body:JSON.stringify(body)
    },{ENVIRONMENT:'development',ENABLE_COMPANY_SCHEDULES:opts.flag??'true'} as any);
  return {send,sqls,batches};
}

describe('CR JORNADA — atribuição atômica da jornada a todos os ativos',()=>{
  it('atribui dois funcionários em um único D1.batch com auditoria e guardas',async()=>{
    const t=setup();
    const response=await t.send({effective_from:'2026-10-26'});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      company_id:'company-a',assigned_count:2,reused_count:0
    });
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(8);
    for(const [i,id] of ['employee-a','employee-b'].entries()){
      const [insert,guard,cleanup,audit]=t.batches[0].slice(i*4,i*4+4);
      expect(insert.sql).toContain('NOT EXISTS (SELECT 1 FROM schedule_assignments existing');
      expect(insert.sql).toContain('cas.auth_version=ca.auth_version');
      expect(insert.params).toContain(id);
      expect(insert.params).toContain('company-a');
      expect(guard.sql).toContain('VALUES (?,changes())');
      expect(cleanup.sql).toContain('WHERE id=?');
      expect(guard.params[0]).toEqual(cleanup.params[0]);
      expect(audit.sql).toContain('company_schedule_audit');
      expect(audit.params).toContain(id);
    }
    const listQuery=t.sqls.find(q=>q.sql.includes('FROM employees e JOIN companies co'));
    expect(listQuery?.params).toEqual(['2026-10-26','company-a']);
    expect(listQuery?.sql).toContain("e.status='active' AND e.deleted_at IS NULL");
  });
  it('repetir o mesmo lote não gera novas atribuições ou auditoria',async()=>{
    const t=setup('already');
    const response=await t.send({effective_from:'2026-10-26'});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      assigned_count:0,reused_count:2,reused:true
    });
    expect(t.batches).toHaveLength(0);
  });
  it('outro turno na mesma data bloqueia lote inteiro antes da gravação',async()=>{
    const t=setup('conflict');
    const response=await t.send({effective_from:'2026-10-26'});
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe('schedule_date_conflict');
    expect(t.batches).toHaveLength(0);
  });
  it('não atribui caso sessão seja revogada durante o batch',async()=>{
    const t=setup('revoked');
    const response=await t.send({effective_from:'2026-10-26'});
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe('bulk_assignment_conflict');
    expect(t.batches).toHaveLength(1);
  });
  it('não altera empresa sem funcionários ativos ou jornada da empresa',async()=>{
    for(const variant of ['no-staff','bad-schedule','overflow'] as Variant[]){
      const t=setup(variant);
      const response=await t.send({effective_from:'2026-10-26'});
      expect(response.status).toBe(variant==='bad-schedule'?404:409);
      expect(t.batches).toHaveLength(0);
    }
  });
  it('bloqueia data inválida, CSRF e feature flag desativada',async()=>{
    const t=setup();
    expect((await t.send({effective_from:'2026-02-30'})).status).toBe(400);
    expect((await t.send({effective_from:'2026-10-26'}, {csrf:'errado'})).status).toBe(403);
    expect((await t.send({effective_from:'2026-10-26'}, {flag:''})).status).toBe(503);
    expect(t.batches).toHaveLength(0);
  });
});
