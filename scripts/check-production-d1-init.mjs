import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {auditTargets,cloudflareReadOnlyInventory,cloudflareReadOnlySchema} from './cloudflare-readonly.mjs';

export const EXPECTED_DATABASE_ID='39045448-774c-4687-8bb9-26c7c3b2f963';
export const EXPECTED_DATABASE_NAME='cr-jornada-db';
export const EXPECTED_WORKER='gestor-ponto-multiempresa';

export function assertFirstInstallSafe({config,inventory,schema}) {
 const database=config?.d1_databases?.find(x=>x.binding==='DB');
 if(database?.database_id!==EXPECTED_DATABASE_ID ||
   database?.database_name!==EXPECTED_DATABASE_NAME) throw new Error('Banco D1 da configuracao nao autorizado.');
 if(!inventory?.worker_encontrado || !inventory?.worker_db_vinculado_ao_d1_correto ||
   !inventory?.d1_encontrado || !inventory?.d1_nome_corresponde_ao_configurado)
   throw new Error('Worker e D1 nao correspondem aos recursos autorizados.');
 if(schema?.total_tabelas_nao_internas!==1 ||
   schema.nomes_das_tabelas_sem_dados?.length!==1 ||
   schema.nomes_das_tabelas_sem_dados[0]!=='_cf_KV' ||
   schema?.tabela_platform_admins || schema?.tabela_platform_audit_log ||
   schema?.tabela_rate_limits || schema?.tabela_platform_sessions ||
   schema?.quantidade_superadmins!==null || schema?.migracoes_registradas!==null)
   throw new Error('Banco nao esta no estado inicial autorizado. Nenhuma migracao executada.');
 return true;
}
export async function confirmD1RecoveryBookmark({token,targets,fetchImpl=fetch}) {
 if(typeof token!=='string'||token.length<10) throw new Error('Token D1 ausente.');
 const r=await fetchImpl(targets.apiBase+'/d1/database/'+encodeURIComponent(targets.databaseId)+'/time_travel/bookmark',{
   method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   signal:AbortSignal.timeout(25000)
 });
 if(!r.ok) throw new Error('D1 nao forneceu bookmark (HTTP '+r.status+').');
 const d=await r.json();
 if(!d?.success||typeof d?.result?.bookmark!=='string'||
   !/^[a-zA-Z0-9-]{10,200}$/.test(d.result.bookmark))
   throw new Error('Bookmark D1 nao confirmado; operacao bloqueada.');
 return true; // Nunca expor bookmark no log publico.
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
 try{
   const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
   const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
   const token=process.env.CLOUDFLARE_AUDIT_TOKEN;
   const editToken=process.env.CLOUDFLARE_API_TOKEN;
   if(typeof editToken!=='string'||editToken.length<10) throw new Error('Token D1 Edit ausente.');
   if(!/^[a-f0-9]{32}$/i.test(accountId||''))throw new Error('Account ID ausente.');
   const targets=auditTargets(config,accountId,EXPECTED_WORKER);
   const inventory=await cloudflareReadOnlyInventory({token,targets});
   const schema=await cloudflareReadOnlySchema({token,targets});
   assertFirstInstallSafe({config,inventory,schema});
   await confirmD1RecoveryBookmark({token,targets});
   console.log('Inicializacao D1 autorizavel: banco exato, esquema inicial, binding e bookmark confirmados.');
 }catch(error){
   console.error('Inicializacao bloqueada: '+(error instanceof Error?error.message:'Erro desconhecido.'));
   process.exitCode=1;
 }
}
