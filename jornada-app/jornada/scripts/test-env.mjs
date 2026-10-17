import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createConnection} from 'node:net';
import {config} from './lib.mjs';
const running=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:8788});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(800,()=>finish(true));});
if(running)throw new Error('Pare o servidor da porta 8788 antes de recriar o banco de testes. Nenhum arquivo foi apagado.');
if (!existsSync('.dev.vars')) throw new Error('Execute npm run secrets:local primeiro.');
// Execute somente com o servidor de testes parado. Nunca toca no D1 principal (.data) ou remoto.
if(existsSync('.test-data'))rmSync('.test-data',{recursive:true,force:true});
mkdirSync('.test-data',{recursive:true});
const main=config();
const test={...main,name:'jornada-tests',d1_databases:[{binding:'DB',database_name:'jornada-tests-local',database_id:'local-jornada-tests-only',migrations_dir:'migrations'}],vars:{...main.vars,ENVIRONMENT:'test',APP_ORIGIN:'http://127.0.0.1:8788'}};
writeFileSync('wrangler.test.jsonc',JSON.stringify(test,null,2)+'\n');
const secret=(name)=>readFileSync('.dev.vars','utf8').match(new RegExp('^'+name+'="?([^"\\r\\n]+)"?','m'))?.[1];
writeFileSync('.test-data/context.json',JSON.stringify({bootstrapToken:secret('BOOTSTRAP_TOKEN'),adminLogin:'admin.teste',adminPassword:randomBytes(18).toString('base64url'),employeePassword:randomBytes(18).toString('base64url'),newEmployeePassword:randomBytes(18).toString('base64url'),otherPassword:randomBytes(18).toString('base64url')},null,2),{mode:0o600});
console.log('Banco de testes isolado preparado. Credenciais aleatórias não serão impressas nem incluídas na entrega.');
