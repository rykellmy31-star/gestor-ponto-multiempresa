import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertFirstInstallSafe,confirmD1RecoveryBookmark,EXPECTED_DATABASE_ID,EXPECTED_DATABASE_NAME} from './check-production-d1-init.mjs';
const config={d1_databases:[{binding:'DB',database_id:EXPECTED_DATABASE_ID,database_name:EXPECTED_DATABASE_NAME}]};
const inventory={worker_encontrado:true,worker_db_vinculado_ao_d1_correto:true,d1_encontrado:true,d1_nome_corresponde_ao_configurado:true};
const schema={total_tabelas_nao_internas:1,nomes_das_tabelas_sem_dados:['_cf_KV'],tabela_platform_admins:false,tabela_platform_audit_log:false,tabela_rate_limits:false,tabela_platform_sessions:false,quantidade_superadmins:null,migracoes_registradas:null};
test('instalacao limitada ao ID D1 e Worker verificados',()=>{
 assert.equal(assertFirstInstallSafe({config,inventory,schema}),true);
 assert.throws(()=>assertFirstInstallSafe({config:{d1_databases:[{...config.d1_databases[0],database_id:'00000000-0000-4000-8000-000000000000'}]},inventory,schema}),/nao autorizado/);
 assert.throws(()=>assertFirstInstallSafe({config,inventory:{...inventory,worker_db_vinculado_ao_d1_correto:false},schema}),/nao correspondem/);
});
test('recusar quaisquer tabelas de negocio ou migracoes ja existentes',()=>{
 assert.throws(()=>assertFirstInstallSafe({config,inventory,schema:{...schema,total_tabelas_nao_internas:2,nomes_das_tabelas_sem_dados:['_cf_KV','employees']}}),/estado inicial/);
 assert.throws(()=>assertFirstInstallSafe({config,inventory,schema:{...schema,nomes_das_tabelas_sem_dados:['d1_migrations']}}),/estado inicial/);
 assert.throws(()=>assertFirstInstallSafe({config,inventory,schema:{...schema,quantidade_superadmins:1}}),/estado inicial/);
});
test('exigir bookmark de recuperacao antes de alterar D1',async()=>{
 const targets={apiBase:'https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32),databaseId:EXPECTED_DATABASE_ID};
 let method='';
 assert.equal(await confirmD1RecoveryBookmark({token:'token-ficticio-somente-teste',targets,fetchImpl:async(_url,opts)=>{
   method=opts.method;
   return {ok:true,json:async()=>({success:true,result:{bookmark:'00000000-1111-2222-3333-444444444444'}})};
 }}),true);
 assert.equal(method,'GET');
 await assert.rejects(()=>confirmD1RecoveryBookmark({token:'token-ficticio-somente-teste',targets,fetchImpl:async()=>({ok:true,json:async()=>({success:true,result:{}})})}),/Bookmark/);
});

// Garante que uma instalação parcial nunca é tratada como banco novo.
test('recusar instalacao parcial com tabelas de autenticação já criadas',()=>{
 assert.throws(()=>assertFirstInstallSafe({config,inventory,schema:{
   ...schema,total_tabelas_nao_internas:2,
   nomes_das_tabelas_sem_dados:['_cf_KV','platform_admins'],
   tabela_platform_admins:true,quantidade_superadmins:0
 }}),/estado inicial/);
});
