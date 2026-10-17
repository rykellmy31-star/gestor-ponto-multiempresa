import {createReadStream,createWriteStream,openSync,readSync,closeSync,existsSync,renameSync,rmSync,statSync} from 'node:fs';
import {scryptSync,createDecipheriv} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {secretInput} from './lib.mjs';
const [input,output]=process.argv.slice(2),magic=Buffer.from('JORNADABK1'),n=magic.length;
if(!input||!output||!output.endsWith('.sql'))throw new Error('Uso: node scripts/decrypt-backup.mjs caminho.jdb destino.sql');
if(existsSync(output)||existsSync(output+'.partial'))throw new Error('O destino já existe. Não sobrescreva um backup ou banco em uso.');
if(statSync(input).size<n+61)throw new Error('Arquivo de backup inválido.');
const header=Buffer.alloc(n+60),fd=openSync(input,'r');try{readSync(fd,header,0,header.length,0);}finally{closeSync(fd);}
if(!header.subarray(0,n).equals(magic))throw new Error('Arquivo de backup inválido.');
const password=await secretInput('Frase de proteção do backup: '),salt=header.subarray(n,n+32),iv=header.subarray(n+32,n+44),tag=header.subarray(n+44,n+60);
const key=scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:64*1024*1024}),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(magic);decipher.setAuthTag(tag);
try{
  await pipeline(createReadStream(input,{start:n+60}),decipher,createWriteStream(output+'.partial',{flags:'wx',mode:0o600}));
  // Nenhum SQL de restauração é disponibilizado sem verificar a autenticação GCM.
  renameSync(output+'.partial',output);
}catch{throw new Error('Frase incorreta, backup adulterado ou erro de leitura/gravação. Nenhum SQL de restauração foi disponibilizado.');}
finally{rmSync(output+'.partial',{force:true});}
console.log('SQL descriptografado em '+output+'. Contém dados pessoais: restaure em um NOVO banco vazio, valide e elimine o SQL temporário com segurança.');
