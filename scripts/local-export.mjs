// node:sqlite é usado somente na ferramenta LOCAL de backup; nunca no Worker.
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,openSync,writeSync,closeSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const identifier=name=>'"'+name.replaceAll('"','""')+'"';
const literal=value=>{
  if(value===null)return 'NULL';
  if(typeof value==='number'||typeof value==='bigint')return String(value);
  if(value instanceof Uint8Array)return "X'"+Buffer.from(value).toString('hex')+"'";
  const text=String(value);
  return text.includes('\0')?"CAST(X'"+Buffer.from(text).toString('hex')+"' AS TEXT)":"'"+text.replaceAll("'","''")+"'";
};
export function localExport(persist,output){
  const root=join(persist,'v3','d1');
  if(!existsSync(root))throw new Error('Banco local não encontrado. Não foi criado um banco vazio para backup.');
  const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
  const files=walk(root).filter(p=>p.endsWith('.sqlite')&&!p.endsWith('metadata.sqlite'));
  if(files.length!==1)throw new Error('O diretório local deve conter exatamente um banco D1 da aplicação. Separe bancos por --persist-to.');
  const db=new DatabaseSync(files[0],{readOnly:true});let fd;
  try{
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='punches'").get())throw new Error('O banco selecionado não pertence ao Jornada.');
    // Snapshot transacional consistente, mesmo com SQLite em modo WAL.
    db.exec('BEGIN');
    const objects=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END,name").all();
    fd=openSync(output,'wx',0o600);const line=s=>writeSync(fd,s+'\n');line('PRAGMA defer_foreign_keys=TRUE;');
    for(const object of objects.filter(o=>o.type==='table'))line(object.sql+';');
    for(const table of objects.filter(o=>o.type==='table')){
      const columns=db.prepare(`PRAGMA table_info(${identifier(table.name)})`).all().map(c=>c.name);
      const statement=db.prepare(`SELECT ${columns.map(identifier).join(',')} FROM ${identifier(table.name)}`);statement.setReadBigInts(true);
      for(const row of statement.iterate())line(`INSERT INTO ${identifier(table.name)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(c=>literal(row[c])).join(',')});`);
    }
    // Só depois dos dados: triggers de imutabilidade e de revisão não interferem na restauração.
    for(const object of objects.filter(o=>o.type!=='table'))line(object.sql+';');
    db.exec('COMMIT');
  }finally{if(fd!==undefined)closeSync(fd);db.close();}
}
