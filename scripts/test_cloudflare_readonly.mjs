import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditTargets, summarizeReadOnlyResults, cloudflareReadOnlyInventory } from './cloudflare-readonly.mjs';

const config = { d1_databases: [
  { binding:'DB', database_name:'cr-jornada-db', database_id:'39045448-774c-4687-8bb9-26c7c3b2f963' }
] };
const targets = auditTargets(config, 'a'.repeat(32));
test('auditoria recusa configuracao/conta incorreta', () => {
  assert.throws(() => auditTargets(config,'conta-falsa'), /conta invalido/);
  assert.throws(() => auditTargets({d1_databases: []},'a'.repeat(32)), /Binding D1/);
  assert.throws(() => auditTargets(config,'a'.repeat(32),'../outro-worker'), /Worker invalido/);
});
test('auditoria imprime apenas estados booleanos, sem segredos nem registros', () => {
  const raw = [
    { success:true, result:{ name:'cr-jornada-db', dados_sigilosos:'ocultos' } },
    { success:true, result:{ enabled:true, cpf:'oculto' } },
    { success:true, result:{ deployments:[{ id:'private', metadata:'oculto' }] } }
  ];
  const summary = summarizeReadOnlyResults(targets,raw);
  assert.deepEqual(summary,{
    worker_encontrado:true,worker_url_publica_ativa:true,
    worker_tem_implantacao:true,d1_encontrado:true,d1_nome_corresponde_ao_configurado:true
  });
  assert.equal(JSON.stringify(summary).includes('oculto'),false);
});
test('consultas remotas usam exclusivamente GET, conta e recurso fixos', async () => {
  const visited=[];
  const fetchImpl=async (url, options)=>{
    visited.push({url,options});
    if(url.includes('/d1/database/')) return {ok:true,json:async()=>({success:true,result:{name:'cr-jornada-db'}})};
    if(url.endsWith('/subdomain')) return {ok:true,json:async()=>({success:true,result:{enabled:true}})};
    if(url.includes('/deployments?')) return {ok:true,json:async()=>({success:true,result:{deployments:[{id:'a'}]}})};
    throw Error('URL desconhecida');
  };
  const r=await cloudflareReadOnlyInventory({token:'segredo-de-teste-nao-real',targets,fetchImpl});
  assert.equal(visited.length,3);
  assert.ok(visited.every(v=>v.options.method==='GET'));
  assert.ok(visited.every(v=>v.url.startsWith(targets.apiBase)));
  assert.ok(visited.every(v=>v.options.headers.Authorization==='Bearer segredo-de-teste-nao-real'));
  assert.ok(Object.values(r).every(Boolean));
});
test('falhas remotas nunca exibem token nem corpo completo', async () => {
  await assert.rejects(
    ()=>cloudflareReadOnlyInventory({token:'segredo-de-teste-nao-real',targets,
      fetchImpl:async()=>({ok:false,status:403})}), /HTTP 403/
  );
});

test('auditoria SQL usa exclusivamente SELECT fixo e mostra apenas contagens', async () => {
  const visited = [];
  const fetchImpl = async (url, options) => {
    visited.push({url,options});
    const sql = JSON.parse(options.body).sql;
    const results = sql.includes('sqlite_master')
      ? [{name:'rate_limits'},{name:'platform_admins'},{name:'platform_sessions'},
         {name:'platform_audit_log'},{name:'d1_migrations'}]
      : [{total:sql.includes('platform_admins')?1:38}];
    return {ok:true,json:async()=>({success:true,result:[{
      success:true,meta:{changed_db:false,rows_written:0},results
    }]})};
  };
  const {cloudflareReadOnlySchema} = await import('./cloudflare-readonly.mjs');
  const r = await cloudflareReadOnlySchema({token:'teste-segredo-restrito-2026',targets,fetchImpl});
  assert.equal(r.tabelas_basicas_superadmin_presentes,true);
  assert.equal(r.quantidade_superadmins,1);
  assert.equal(r.migracoes_registradas,38);
  assert.equal(visited.length,3);
  assert.ok(visited.every(x=>x.options.method==='POST'));
  assert.ok(visited.every(x=>x.url.endsWith('/query')));
  assert.ok(visited.every(x=>/^SELECT /i.test(JSON.parse(x.options.body).sql)));
  assert.equal(JSON.stringify(r).includes('teste-segredo'),false);
});
test('esquema inexistente nao tenta ler tabela ausente',async()=>{
  const {cloudflareReadOnlySchema} = await import('./cloudflare-readonly.mjs');
  const r=await cloudflareReadOnlySchema({token:'teste-segredo-restrito-2026',targets,
    fetchImpl:async(_url,opts)=>{
      assert.match(JSON.parse(opts.body).sql,/sqlite_master/);
      return {ok:true,json:async()=>({success:true,result:[{
        success:true,meta:{changed_db:false,rows_written:0},results:[]
      }]})};
    }});
  assert.equal(r.tabelas_basicas_superadmin_presentes,false);
  assert.equal(r.quantidade_superadmins,null);
  assert.equal(r.migracoes_registradas,null);
});
