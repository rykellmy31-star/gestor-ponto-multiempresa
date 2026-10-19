import { jsonBody } from './helpers/json-body';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../server/types';
import { ApiError } from '../server/core/errors';
import { salesLeadPublicRoutes, salesLeadAdminRoutes } from '../server/routes/sales-leads';
import { defaultSalesPage } from '../shared/sales-page';

vi.mock('../server/core/security', () => ({
  ipHash: () => 'ip-teste',
  limit: async () => undefined
}));

const validInput = {
  name: 'Pessoa de Teste',
  email: 'teste@exemplo.com',
  company: 'Empresa Exemplo',
  message: 'Gostaria de entender melhor o CR JORNADA.',
  plan_id: 'essencial',
  consent: true,
  website: ''
};

function setup({
  enabled = true, published = true,
  form = true, admin = true, changes = 1
}: {
  enabled?: boolean; published?: boolean; form?: boolean;
  admin?: boolean; changes?: number
} = {}) {
  const calls: Array<{sql:string; params:unknown[]}> = [];
  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {params=args;return stmt;},
        async first() {
          calls.push({sql,params});
          if (sql.includes('FROM sales_page_settings')) return {
            published: published ? 1 : 0,
            published_json: JSON.stringify({
              ...defaultSalesPage, lead_form_enabled: form,
              privacy_url: 'https://example.com/privacidade'
            })
          };
          if (sql.includes('FROM platform_sessions s')) {
            if (!admin) return null;
            return {
              id: 'admin-teste',login:'admin',
              email:null,display_name:'Admin Teste',
              csrf_token:'csrf-teste',
              expires_at:Date.now()+60000,last_seen_at:Date.now()
            };
          }
          return null;
        },
        async all() {
          calls.push({sql,params});
          return { results: [{
            id:'a'.repeat(8)+'-'+ 'b'.repeat(4)+'-'+ 'c'.repeat(4)+'-'+
              'd'.repeat(4)+'-'+ 'e'.repeat(12),
            name:'Pessoa de Teste',email:'teste@exemplo.com',
            company:'Empresa Exemplo',message:'Mensagem de teste',
            status:'new',plan_id:'essencial',created_at:Date.now()
          }] };
        },
        async run() {
          calls.push({sql,params});
          return {meta:{changes}};
        }
      };
      return stmt;
    }
  };
  const app = new Hono<App>();
  app.use('*',async(c,next)=>{
    c.set('db',db as unknown as D1DatabaseSession);
    await next();
  });
  app.route('/api/public',salesLeadPublicRoutes);
  app.route('/api/platform/leads',salesLeadAdminRoutes);
  app.onError((e,c)=>e instanceof ApiError
    ? c.json({error:{code:e.code}},e.status as any)
    : c.json({error:{code:'internal_error'}},500));
  const env = { ENVIRONMENT:'development',
    ENABLE_SALES_LEADS:enabled?'true':'false',
    SALES_LEADS_RETENTION_DAYS: '90'
  } as any;
  function submit(body: object) {
    return app.request('/api/public/leads',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(body)
    },env);
  }
  function adminRequest(
    path='',
    method:'GET'|'PATCH'|'DELETE'='GET',
    body?:object,csrf='csrf-teste',cookie=true
  ) {
    return app.request('/api/platform/leads'+path,{
      method,headers:{
        ...(cookie?{cookie:'cr_jornada_platform_dev='+'a'.repeat(64)}:{}),
        ...(method==='GET'?{}:{'X-CSRF-Token':csrf}),
        ...(body?{'content-type':'application/json'}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{})
    },env);
  }
  return {submit,adminRequest,calls};
}

describe('CR JORNADA — pedidos de contato comerciais seguros',()=>{
  it('mantem formulario bloqueado ate ativacao explicita do servidor',async()=>{
    const t=setup({enabled:false});
    expect((await t.submit(validInput)).status).toBe(503);
    expect(t.calls).toHaveLength(0);
  });
  it('nao recebe mensagens em pagina nao publicada nem com formulario desligado',async()=>{
    const draft=setup({published:false});
    expect((await draft.submit(validInput)).status).toBe(404);
    const disabled=setup({form:false});
    expect((await disabled.submit(validInput)).status).toBe(404);
    expect(draft.calls.some(x=>x.sql.includes('INSERT INTO sales_leads'))).toBe(false);
  });
  it('salva lead valido, sem CPF, IP ou segredos e sem ecoar informacoes',async()=>{
    const t=setup();
    const r=await t.submit(validInput);
    expect(r.status).toBe(201);
    expect(await jsonBody(r)).toEqual({success:true});
    expect(r.headers.get('cache-control')).toContain('no-store');
    const inserted=t.calls.find(x=>x.sql.includes('INSERT INTO sales_leads'));
    expect(inserted).toBeDefined();
    expect(inserted?.params).toContain('teste@exemplo.com');
    expect(JSON.stringify(inserted)).not.toContain('ip-teste');
  });
  it('rejeita falta de consentimento, email invalido e plano estranho',async()=>{
    const t=setup();
    for(const body of [
      {...validInput,consent:false},
      {...validInput,email:'email-invalido'},
      {...validInput,plan_id:'de-outra-empresa'},
      {...validInput,message:'curto'}
    ]){
      const r=await t.submit(body);
      expect(r.status).toBe(400);
    }
    expect(t.calls.some(x=>x.sql.includes('INSERT INTO sales_leads'))).toBe(false);
  });
  it('descarta isca antirrobos sem armazenar o cadastro',async()=>{
    const t=setup();
    const r=await t.submit({...validInput,website:'https://spam.invalid'});
    expect(r.status).toBe(202);
    expect(t.calls).toHaveLength(0);
  });
  it('protege caixa de entrada administrativa por sessao',async()=>{
    const t=setup({admin:false});
    expect((await t.adminRequest('', 'GET', undefined,'csrf-teste',false)).status).toBe(401);
    const a=setup();
    const r=await a.adminRequest();
    expect(r.status).toBe(200);
    expect((await jsonBody(r)).leads).toHaveLength(1);
  });
  it('exige CSRF para marcar atendido e para excluir',async()=>{
    const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const t=setup();
    expect((await t.adminRequest('/'+id,'PATCH',{status:'contacted'},'errado')).status).toBe(403);
    expect((await t.adminRequest('/'+id,'DELETE',undefined,'errado')).status).toBe(403);
    expect((await t.adminRequest('/'+id,'PATCH',{status:'contacted'})).status).toBe(200);
    expect((await t.adminRequest('/'+id,'DELETE')).status).toBe(200);
    expect(t.calls.some(x=>x.sql.includes('DELETE FROM sales_leads'))).toBe(true);
  });
  it('nao permite marcar status invalidos',async()=>{
    const t=setup();
    const r=await t.adminRequest('/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','PATCH',{status:'admin'});
    expect(r.status).toBe(400);
  });
});
