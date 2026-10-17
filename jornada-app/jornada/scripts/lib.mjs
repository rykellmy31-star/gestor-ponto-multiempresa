import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import ts from 'typescript';
export function config(path='wrangler.jsonc'){
  const p=ts.parseConfigFileTextToJson(path,readFileSync(path,'utf8'));
  if(p.error)throw new Error('JSONC de configuração inválido.');return p.config;
}
export function wrangler(args,{capture=false}={}){
  const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(r.status!==0)throw new Error(capture?'Comando Wrangler falhou. Confira sua autorização e o banco selecionado.':'O Wrangler não concluiu a operação.');
  return r.stdout;
}
export async function secretInput(prompt){
  if(process.env.BACKUP_PASSWORD)return process.env.BACKUP_PASSWORD;
  if(!process.stdin.isTTY)throw new Error('Use um terminal interativo privado. Para automação, injete BACKUP_PASSWORD pelo cofre de segredos do executor.');
  let muted=false;const output=new Writable({write(chunk,enc,cb){if(!muted)process.stdout.write(chunk);cb();}});
  const rl=createInterface({input:process.stdin,output,terminal:true});
  return new Promise(resolve=>{rl.question(prompt,value=>{muted=false;rl.close();process.stdout.write('\n');resolve(value);});muted=true;});
}
export function mode(args){const local=args.includes('--local'),remote=args.includes('--remote');if(local===remote)throw new Error('Escolha explicitamente --local ou --remote.');return local?'local':'remote';}
