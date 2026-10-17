import {mkdirSync,mkdtempSync,writeFileSync,rmSync,createReadStream,createWriteStream,openSync,writeSync,closeSync,renameSync,statSync} from 'node:fs';
import {randomBytes,scryptSync,createCipheriv,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {resolve,join} from 'node:path';
import {mode,secretInput,wrangler,config} from './lib.mjs';
const args=process.argv.slice(2),selected=mode(args);process.umask(0o077);
const pathArg=args.indexOf('--config'),cfgPath=pathArg>=0?args[pathArg+1]:'wrangler.jsonc';config(cfgPath);
const password=await secretInput('Frase de proteção do backup (mínimo 16 caracteres): ');
if(password.length<16)throw new Error('A frase do backup deve ter pelo menos 16 caracteres.');
if(!process.env.BACKUP_PASSWORD){const confirm=await secretInput('Repita a frase: ');if(confirm!==password)throw new Error('As frases não conferem.');}
mkdirSync('backups',{recursive:true,mode:0o700});const work=mkdtempSync(resolve('backups/.work-')),plain=join(work,'export.sql');
const filename=resolve('backups',`jornada-${selected}-${new Date().toISOString().replace(/[:.]/g,'-')}.jdb`),partial=filename+'.partial';
try{
  const persistArg=args.indexOf('--persist-to'),persist=persistArg>=0?args[persistArg+1]:'.data';
  console.log(`Exportando D1 ${selected==='local'?'LOCAL':'REMOTO'}. O export remoto pode bloquear consultas durante a operação; use uma janela planejada.`);
  if(selected==='local'){const {localExport}=await import('./local-export.mjs');localExport(persist,plain);}
  else wrangler(['d1','export','DB','--remote','--config',cfgPath,'--output',plain,'--skip-confirmation']);
  const salt=randomBytes(32),iv=randomBytes(12),key=scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024});
  const cipher=createCipheriv('aes-256-gcm',key,iv),magic=Buffer.from('JORNADABK1');cipher.setAAD(magic);
  const destination=createWriteStream(partial,{flags:'wx',mode:0o600});destination.write(Buffer.concat([magic,salt,iv,Buffer.alloc(16)]));
  await pipeline(createReadStream(plain),cipher,destination);
  const fd=openSync(partial,'r+');try{writeSync(fd,cipher.getAuthTag(),0,16,magic.length+44);}finally{closeSync(fd);}
  renameSync(partial,filename);
  const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);
  writeFileSync(filename+'.manifest.json',JSON.stringify({format:'JORNADABK1',encryption:'AES-256-GCM',kdf:'scrypt N=32768 r=8 p=3',created_at:new Date().toISOString(),mode:selected,sha256:hash.digest('hex'),bytes:statSync(filename).size},null,2),{mode:0o600});
  console.log('Backup cifrado salvo em '+filename+'\nGuarde a frase e os Secrets AUTH_PEPPER/DATA_KEY em cofre separado. Teste a restauração em outro banco.');
}finally{rmSync(partial,{force:true});rmSync(work,{recursive:true,force:true});}
