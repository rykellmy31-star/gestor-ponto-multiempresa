import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertD1Initialized} from './check-production-d1-after.mjs';
const good={tabela_rate_limits:true,tabela_platform_admins:true,tabela_platform_sessions:true,tabela_platform_audit_log:true,tabelas_basicas_superadmin_presentes:true,migracoes_registradas:38,quantidade_superadmins:0,total_tabelas_nao_internas:45};
test('pos-validacao exige schema e 38 migrations completas',()=>{
 assert.equal(assertD1Initialized(good),true);
 for(const patch of [{tabela_platform_admins:false},{migracoes_registradas:37},{quantidade_superadmins:1},{total_tabelas_nao_internas:1},{tabelas_basicas_superadmin_presentes:false}])
   assert.throws(()=>assertD1Initialized({...good,...patch}),/migrations/);
});
