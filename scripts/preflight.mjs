import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {config} from './lib.mjs';
const c=config();const failures=[];
if(c.vars?.ENVIRONMENT!=='production')failures.push('ENVIRONMENT deve ser production no arquivo de publicação.');
let origin;try{origin=new URL(c.vars?.APP_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==c.vars.APP_ORIGIN||origin.hostname.endsWith('.invalid'))throw 0;}catch{failures.push('Configure APP_ORIGIN com a origem HTTPS real, sem caminho ou barra final.');}
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.d1_databases?.find(d=>d.binding==='DB')?.database_id||''))failures.push('Substitua o database_id pelo identificador REAL retornado por wrangler d1 create.');
if(!c.compatibility_flags?.includes('nodejs_compat'))failures.push('nodejs_compat é necessário para scrypt e PDF.');
if(c.assets?.run_worker_first!==true)failures.push('Mantenha assets.run_worker_first=true para proteger páginas no servidor.');
if(!existsSync('public/index.html'))failures.push('Execute npm run build:web.');
if(existsSync('.dev.vars')){
 const secrets=[...readFileSync('.dev.vars','utf8').matchAll(/^[A-Z_]+=["']?([^"'\r\n]{32,})/gm)].map(m=>m[1]);
 const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
 for(const p of walk('public').filter(p=>/\.(html|js|css|json)$/.test(p)))if(secrets.some(s=>readFileSync(p,'utf8').includes(s)))failures.push('Um segredo local foi encontrado nos arquivos públicos. Publicação bloqueada.');
}
if(failures.length){console.error('Publicação bloqueada:\n'+failures.map(x=>' • '+x).join('\n'));process.exit(1);}
console.log('Configuração estática validada. Confirme D1 remoto migrado, plano Workers Paid e Secrets na conta correta. O teste em produção continua obrigatório.');
