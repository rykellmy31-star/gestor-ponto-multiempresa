import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrangler=join(process.cwd(),'node_modules','.bin',
  process.platform==='win32'?'wrangler.cmd':'wrangler'
);
function execute(args:string[],dir:string){
  return execFileSync(wrangler,[
    'd1',...args,'--config','wrangler.jsonc','--local','--persist-to',dir
  ],{cwd:process.cwd(),encoding:'utf8',timeout:120000,
    stdio:['ignore','pipe','pipe']});
}
function query(sql:string,dir:string){
  const res=JSON.parse(execute(['execute','DB','--command',sql,'--json'],dir)) as
    Array<{success:boolean;results:Array<Record<string,unknown>>}>;
  expect(res[0].success).toBe(true);
  return res[0].results||[];
}
function rejection(sql:string,dir:string){
  try{query(sql,dir);}catch(err){
    const e=err as {stdout?:string;stderr?:string;message?:string};
    return [e.message,e.stdout,e.stderr].join('\n');
  }
  throw new Error('O banco permitiu cruzar identidades de empresas diferentes.');
}

describe('CR JORNADA — senha inicial empresarial no banco D1 local',()=>{
  it('exige troca para gestores, preserva empresas isoladas e guarda auditoria',()=>{
    const dir=mkdtempSync(join(tmpdir(),'cr-jornada-company-password-'));
    try{
      execute(['migrations','apply','DB'],dir);
      const path=join(dir,'fixture.sql');
      const statements=[
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-a','Loja A','a','loja-a',1760000000000,1760000000000)",
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-b','Loja B','b','loja-b',1760000000000,1760000000000)",
        "INSERT INTO company_admins(id,company_id,login,display_name,password_hash,created_at,updated_at) VALUES('adm-a','co-a','gestor','Gestor A','hash-antigo-a',1760000000000,1760000000000)",
        "INSERT INTO company_admins(id,company_id,login,display_name,password_hash,created_at,updated_at) VALUES('adm-b','co-b','gestor','Gestor B','hash-antigo-b',1760000000000,1760000000000)",
        "INSERT INTO company_admin_sessions(token_hash,company_id,admin_id,csrf_token,created_at,expires_at,last_seen_at) VALUES('token-a','co-a','adm-a','csrf-a',1760000000000,1900000000000,1760000000000)",
        "INSERT INTO company_admin_sessions(token_hash,company_id,admin_id,csrf_token,created_at,expires_at,last_seen_at) VALUES('token-b','co-b','adm-b','csrf-b',1760000000000,1900000000000,1760000000000)"
      ];
      writeFileSync(path,statements.join(';\n')+';\n','utf8');
      const imported=JSON.parse(execute(['execute','DB','--file',path,'--json'],dir)) as
        Array<{success:boolean}>;
      expect(imported.every(item=>item.success)).toBe(true);

      expect(query('SELECT id,must_change_password FROM company_admins ORDER BY id',dir))
        .toEqual([
          {id:'adm-a',must_change_password:1},
          {id:'adm-b',must_change_password:1}
        ]);

      query([
        "UPDATE company_admins SET password_hash='hash-novo-a',",
        'must_change_password=0,auth_version=auth_version+1,',
        "updated_at=1760000001000 WHERE id='adm-a' AND company_id='co-a'"
      ].join(' '),dir);
      query("DELETE FROM company_admin_sessions WHERE admin_id='adm-a' AND company_id='co-a'",dir);
      query([
        'INSERT INTO company_admin_security_events',
        '(id,company_id,admin_id,action,created_at)',
        "VALUES('event-a','co-a','adm-a','password_changed',1760000001000)"
      ].join(' '),dir);

      expect(query('SELECT id,must_change_password,auth_version FROM company_admins ORDER BY id',dir))
        .toEqual([
          {id:'adm-a',must_change_password:0,auth_version:1},
          {id:'adm-b',must_change_password:1,auth_version:0}
        ]);
      expect(query('SELECT company_id,admin_id FROM company_admin_sessions',dir))
        .toEqual([{company_id:'co-b',admin_id:'adm-b'}]);
      expect(query('SELECT company_id,admin_id,action FROM company_admin_security_events',dir))
        .toEqual([{company_id:'co-a',admin_id:'adm-a',action:'password_changed'}]);

      expect(rejection([
        'INSERT INTO company_admin_security_events',
        '(id,company_id,admin_id,action,created_at)',
        "VALUES('cross','co-b','adm-a','password_changed',1760000002000)"
      ].join(' '),dir)).toMatch(/company_admin_security_event_mismatch/);
      expect(query('PRAGMA foreign_key_check',dir)).toHaveLength(0);
    }finally{
      rmSync(dir,{recursive:true,force:true});
    }
  },240000);
});
