import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditTargets,cloudflareReadOnlySchema} from './cloudflare-readonly.mjs';
import {EXPECTED_DATABASE_ID,EXPECTED_WORKER} from './check-production-d1-init.mjs';

export function assertD1Initialized(schema) {
 const required=['tabela_rate_limits','tabela_platform_admins','tabela_platform_sessions','tabela_platform_audit_log'];
 if(schema?.tabelas_basicas_superadmin_presentes!==true ||
   required.some(name=>schema?.[name]!==true) ||
   schema?.migracoes_registradas!==38 ||
   schema?.quantidade_superadmins!==0 ||
   !(schema?.total_tabelas_nao_internas>38)) {
   throw new Error('As 38 migrations e tabelas do Superadmin ainda nao foram confirmadas.');
 }
 return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
   if(config?.d1_databases?.find(x=>x.binding==='DB')?.database_id!==EXPECTED_DATABASE_ID)
     throw new Error('Banco diferente do autorizado.');
   const targets=auditTargets(config,process.env.CLOUDFLARE_ACCOUNT_ID,EXPECTED_WORKER);
   const schema=await cloudflareReadOnlySchema({token:process.env.CLOUDFLARE_AUDIT_TOKEN,targets});
   assertD1Initialized(schema);
   console.log('D1 validado: 38 migrations e tabelas Superadmin presentes; nenhuma conta criada automaticamente.');
 }catch(err){
   console.error('Validacao D1 falhou: '+(err instanceof Error?err.message:'Erro desconhecido.'));
   process.exitCode=1;
 }
}
