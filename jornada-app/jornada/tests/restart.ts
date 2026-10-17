// Rode --before com o servidor de testes ativo, reinicie-o sem apagar .test-data e rode sem argumentos.
import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const cfg=JSON.parse(readFileSync('.test-data/context.json','utf8')),base='http://127.0.0.1:8788';
const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
const file=(persist:string)=>walk(persist+'/v3/d1').find(p=>p.endsWith('.sqlite')&&!p.endsWith('/metadata.sqlite'))!;
function counts(persist:string){return JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys\nc=sqlite3.connect(sys.argv[1]);print(json.dumps({t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['employees','punches','work_days','adjustments','closure_snapshots','audit_log']}))`,file(persist)],{encoding:'utf8'}));}
if(process.argv.includes('--before')){writeFileSync('.test-data/restart-before.json',JSON.stringify(counts('.test-data')));console.log('Snapshot de contagens salvo. Reinicie o servidor de testes, sem preparar/apagar o banco.');}
else{
 const before=JSON.parse(readFileSync('.test-data/restart-before.json','utf8')),after=counts('.test-data');assert.deepEqual(after,before);
 const health:any=await(await fetch(base+'/api/health')).json();assert.equal(health.environment,'test');
 const login=await fetch(base+'/api/auth/admin/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({identifier:cfg.adminLogin,password:cfg.adminPassword})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const report=await fetch(`${base}/api/admin/reports/${cfg.browserEmployeeId}?month=${cfg.current}`,{headers:{Cookie:cookie}});assert.equal(report.status,200);const data:any=await report.json();assert.equal(data.days.reduce((s:number,d:any)=>s+d.raw_marks.filter((m:any)=>m!==null).length,0),4);
 const frozen=await fetch(`${base}/api/admin/reports/${cfg.personA}?month=${cfg.prior}`,{headers:{Cookie:cookie}});assert.equal(frozen.status,200);const stored:any=await frozen.json();assert.equal(stored.closure.status,'closed');assert.equal(stored.closure.version,2);assert.equal(stored.company.company_name,'Empresa de testes isolados');
 const main=counts('.data');assert.equal(main.employees,0);assert.equal(main.punches,0);
 writeFileSync('test-results/persistence.json',JSON.stringify({date:new Date().toISOString(),status:'PASS',target:'D1 LOCAL após parada e novo processo workerd, sem apagar dados',before,after,raw_punches_visible_through_api:4,closed_snapshot_preserved:true,main_installation_clean:true,remote_redeploy_tested:false},null,2));
 console.log('Persistência aprovada após reinício real: contagens idênticas, quatro pontos visíveis pela API e snapshot fechado preservado. Instalação principal continua limpa.');
}
