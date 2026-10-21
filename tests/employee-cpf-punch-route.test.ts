import { jsonBody } from './helpers/json-body';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { getEmployeeCpfSession } from '../server/routes/employee-cpf-auth';
import { employeeCpfPunchRoutes } from '../server/routes/employee-cpf-punch';

vi.mock('../server/routes/employee-cpf-auth', () => ({
  getEmployeeCpfSession: vi.fn()
}));
vi.mock('../server/core/security', () => ({
  ipHash: () => 'ip-hash-test',
  limit: async () => undefined
}));

const fixedNow = Date.UTC(2026,9,19,13,0,0);
const uuid = '11111111-1111-4111-8111-111111111111';
const shift = {
  start:'09:00',break_start:'12:00',break_end:'13:00',end:'18:00',
  weekdays:[1,2,3,4,5],paid_break:false
};
const rules = {
  mark_tolerance:5,daily_tolerance:10,rounding_step:1,
  rounding_mode:'floor',auto_approve_overtime:false,
  compensation:'review',max_shift_hours:24
};
const session = {
  user_id:'user-a',employee_id:'employee-a',company_id:'company-a',
  company_name:'Empresa A',company_slug:'empresa-a',
  company_timezone:'America/Bahia' as const,
  csrf_token:'csrf-abc',token_hash:'token-hash',
  expires_at:fixedNow+600000,last_seen_at:fixedNow,
  must_change_password:0,display_name:'Funcionário Teste'
};

function setup(options:{
  flag?:boolean; policy?:boolean; legacy?:boolean;
  nextSeq?:number; priorType?:string|null; validSchedule?:boolean;
  batchError?:boolean;
}={}) {
  const statements:Array<{sql:string;args:unknown[]}> = [];
  const batched:Array<{sql:string;args:unknown[]}> = [];
  const db = {
    prepare(sql:string) {
      let args:unknown[]=[];
      const st = {
        sql,
        get args() { return args; },
        bind(...values:unknown[]) {args=values;return st;},
        async first() {
          statements.push({sql,args:[...args]});
          if(sql.includes('FROM punches p JOIN work_days d')) {
            if(!options.priorType)return null;
            return {
              id:'punch-previous',type:options.priorType,
              recorded_at:fixedNow,receipt_hash:'receipt-old',
              work_date:'2026-10-19',company_id:'company-a',
              timezone:'America/Bahia'
            };
          }
          if(sql.includes('SELECT co.timezone,e.admission_date')) {
            if(options.policy===false)return null;
            return {
              timezone:'America/Bahia',admission_date:'2026-01-01',
              employment_end:null,rules_json:JSON.stringify(rules)
            };
          }
          if(sql.includes('FROM work_days WHERE employee_id')) {
            if(options.nextSeq===undefined && !options.legacy)return null;
            return {
              id:'day-a',company_id:options.legacy?null:'company-a',
              next_seq:options.nextSeq??0,
              schedule_json:JSON.stringify(shift),
              rules_json:JSON.stringify(rules),
              timezone:'America/Bahia'
            };
          }
          if(sql.includes('FROM schedule_assignments a')) {
            return options.validSchedule===false?null:{
              config_json:JSON.stringify(shift)
            };
          }
          throw new Error('Consulta não esperada: '+sql.slice(0,50));
        },
        async run() {statements.push({sql,args});return {meta:{changes:1}};}
      };
      return st;
    },
    async batch(queries:Array<unknown>) {
      for(const query of queries as Array<{sql:string;args:unknown[]}>) {
        batched.push(query);
      }
      if(options.batchError)throw new Error('UNIQUE constraint failed');
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }
  };
  const app = new Hono<App>();
  app.use('*',async(c,next)=>{
    c.set('db',db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/employee/cpf-work',employeeCpfPunchRoutes);
  app.onError((error,c)=>error instanceof ApiError
    ? c.json({error:{code:error.code}},error.status as any)
    : c.json({error:{code:'internal_error'}},500));
  const env = {ENVIRONMENT:'test',
    ENABLE_EMPLOYEE_PUNCHES:options.flag===false?'false':'true',
    AUTH_PEPPER:'p'.repeat(64)
  };
  function request(path:string,method:'GET'|'POST'='GET',
    body?:unknown,csrf='csrf-abc') {
    return app.request('/api/employee/cpf-work'+path,{
      method,
      headers:{
        ...(method==='POST' ? {
          'Content-Type':'application/json','X-CSRF-Token':csrf
        }:{})
      },
      ...(body ? {body:JSON.stringify(body)}:{})
    },env as any);
  }
  return {request,statements,batched};
}

beforeEach(()=>{
  vi.spyOn(Date,'now').mockReturnValue(fixedNow);
  vi.mocked(getEmployeeCpfSession).mockResolvedValue(session);
});
afterEach(()=>{
  vi.restoreAllMocks();
  vi.mocked(getEmployeeCpfSession).mockReset();
});

describe('CR JORNADA — batida CPF multiempresa em homologação',()=>{
  it('nao oferece qualquer consulta ou batida quando flag global desligada',async()=>{
    const t=setup({flag:false});
    expect((await t.request('/today')).status).toBe(503);
    expect((await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    })).status).toBe(503);
    expect(t.statements).toHaveLength(0);
  });

  it('exige sessao, senha trocada e CSRF antes de gravar',async()=>{
    const t=setup();
    vi.mocked(getEmployeeCpfSession).mockResolvedValueOnce(null);
    expect((await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    })).status).toBe(401);
    vi.mocked(getEmployeeCpfSession).mockResolvedValueOnce({
      ...session,must_change_password:1
    });
    expect((await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    })).status).toBe(403);
    expect((await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    },'csrf-errado')).status).toBe(403);
    expect(t.batched).toHaveLength(0);
  });

  it('consulta proxima batida a partir da sessao, sem aceitar empresa da URL',async()=>{
    const t=setup();
    const result=await t.request('/today?company_id=company-b&employee_id=employee-b');
    expect(result.status).toBe(200);
    const json=await jsonBody(result);
    expect(json.company_id).toBe('company-a');
    expect(json.employee_id).toBe('employee-a');
    expect(json.next_type).toBe('entry');
    const scope=t.statements.find(x=>x.sql.includes('SELECT co.timezone,e.admission_date'));
    expect(scope?.args.slice(0,3)).toEqual([
      'token-hash','employee-a','company-a'
    ]);
    const assigned=t.statements.find(x=>x.sql.includes('FROM schedule_assignments a'));
    expect(assigned?.args).toEqual(['company-a','2026-10-19','employee-a','2026-10-19']);
  });

  it('seleciona a ultima atribuicao vigente com desempate estavel',async()=>{
    const t=setup();
    const response=await t.request('/today');
    expect(response.status).toBe(200);
    const selected=t.statements.find(x=>x.sql.includes('FROM schedule_assignments a'));
    expect(selected?.sql).toContain(
      'ORDER BY a.effective_from DESC,a.created_at DESC,a.id DESC LIMIT 1'
    );
    expect(selected?.sql).toContain('a.effective_from<=?');
    expect(selected?.args).toEqual(['company-a','2026-10-19','employee-a','2026-10-19']);
  });

  it('rejeita empresa sem politica propria ativa ou jornada propria',async()=>{
    expect((await setup({policy:false}).request('/today')).status).toBe(409);
    expect((await setup({validSchedule:false}).request('/today')).status).toBe(409);
  });

  it('nega dia legado sem empresa reconciliada',async()=>{
    const t=setup({legacy:true});
    expect((await t.request('/today')).status).toBe(409);
    expect(t.batched).toHaveLength(0);
  });

  it('apresenta sequencia correta para jornada iniciada',async()=>{
    const t=setup({nextSeq:2});
    const r=await t.request('/today');
    expect(r.status).toBe(200);
    expect((await jsonBody(r)).next_type).toBe('break_end');
  });

  it('evita batida fora de sequencia e ao fim do dia',async()=>{
    const t=setup({nextSeq:2});
    const r=await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    });
    expect(r.status).toBe(409);
    expect(t.batched).toHaveLength(0);
    const full=setup({nextSeq:4});
    expect((await full.request('/punch','POST',{
      type:'exit',idempotency_key:uuid
    })).status).toBe(409);
  });

  it('executa dia e batida juntos, com empresa e sessao revalidadas',async()=>{
    const t=setup();
    const r=await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid,company_id:'company-b'
    });
    expect(r.status).toBe(400); // o body nao admite campos externos
    const valid=await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    });
    expect(valid.status).toBe(201);
    const data=await jsonBody(valid);
    expect(data.replayed).toBe(false);
    expect(data.punch.work_date).toBe('2026-10-19');
    expect(t.batched).toHaveLength(2);
    expect(t.batched[0].sql).toContain('company_punch_policies');
    expect(t.batched[1].sql).toContain('d.company_id=?');
    expect(t.batched[1].sql).toContain('sess.token_hash=?');
    expect(t.batched[1].args).toContain('company-a');
    expect(t.batched[1].args).toContain('token-hash');
  });

  it('devolve confirmacao anterior para mesma chave e tipo sem criar nova batida',async()=>{
    const t=setup({priorType:'entry'});
    const r=await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    });
    expect(r.status).toBe(200);
    expect((await jsonBody(r)).replayed).toBe(true);
    expect(t.batched).toHaveLength(0);
  });

  it('recusa reaproveitar a mesma chave com tipo diferente',async()=>{
    const t=setup({priorType:'entry'});
    const r=await t.request('/punch','POST',{
      type:'exit',idempotency_key:uuid
    });
    expect(r.status).toBe(409);
    expect((await jsonBody(r)).error.code).toBe('idempotency_conflict');
  });

  it('nao confirma falso sucesso quando D1 rejeita operacao concorrente',async()=>{
    const t=setup({batchError:true});
    const r=await t.request('/punch','POST',{
      type:'entry',idempotency_key:uuid
    });
    expect(r.status).toBe(409);
    expect((await jsonBody(r)).error.code).toBe('punch_conflict');
  });
});
