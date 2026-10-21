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
