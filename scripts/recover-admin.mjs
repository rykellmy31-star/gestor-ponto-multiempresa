// Recuperação operacional: exige autenticação Cloudflare do operador, nunca uma API pública.
import {randomBytes,createHash} from 'node:crypto';
import {mode,wrangler,config} from './lib.mjs';
const args=process.argv.slice(2),selected=mode(args),loginAt=args.indexOf('--login'),login=args[loginAt+1];
if(loginAt<0||!login||!/^[a-zA-Z0-9._@+\-]{3,120}$/.test(login))throw new Error('Uso: npm run admin:recover -- --local|--remote --login USUARIO [--reactivate]');
const configAt=args.indexOf('--config'),cfgPath=configAt>=0?args[configAt+1]:'wrangler.jsonc',persistAt=args.indexOf('--persist-to'),persist=persistAt>=0?args[persistAt+1]:'.data';
const c=config(cfgPath),common=['DB','--'+selected,'--config',cfgPath,...(selected==='local'?['--persist-to',persist]:[])];
const result=JSON.parse(wrangler(['d1','execute',...common,'--command',`SELECT id,active FROM users WHERE login='${login.toLowerCase()}' AND role='admin';`,'--json'],{capture:true}));
const user=result[0]?.results?.[0];if(!user)throw new Error('Administrador existente não encontrado. Este comando não cria contas.');
if(!user.active&&!args.includes('--reactivate'))throw new Error('Conta bloqueada. Valide a autorização e use --reactivate explicitamente para reativá-la.');
const now=Date.now(),token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),auditId=crypto.randomUUID();
const statements=[...(args.includes('--reactivate')?[`UPDATE users SET active=1,updated_at=${now} WHERE id='${user.id}';`]:[]),`DELETE FROM password_reset_tokens WHERE user_id='${user.id}';`,`INSERT INTO password_reset_tokens(token_hash,user_id,expires_at,created_at) VALUES('${hash}','${user.id}',${now+30*60000},${now});`,`INSERT INTO audit_log(id,actor_id,action,entity_type,entity_id,details_json,ip_hash,created_at) VALUES('${auditId}',NULL,'auth.operational_reset_issued','user','${user.id}','{"operator":"Cloudflare CLI","reactivated":${args.includes('--reactivate')}}','cloudflare-operator',${now});`];
wrangler(['d1','execute',...common,'--command',statements.join('\n'),'--yes'],{capture:true});
const origin=selected==='local'?'http://localhost:8787':c.vars.APP_ORIGIN;
console.log('Link ADMINISTRATIVO de uso único (30 minutos), exibido somente neste terminal privado:\n'+origin+'/redefinir-senha#token='+token+'\nNão grave este resultado em logs públicos. A emissão foi auditada.');
