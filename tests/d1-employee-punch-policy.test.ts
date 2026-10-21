import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrangler=join(process.cwd(),'node_modules','.bin',
  process.platform==='win32'?'wrangler.cmd':'wrangler');
function exec(args:string[],dir:string) {
  return execFileSync(wrangler,[
    'd1',...args,'--config','wrangler.jsonc','--local','--persist-to',dir
  ],{cwd:process.cwd(),encoding:'utf8',timeout:120000,
    stdio:['ignore','pipe','pipe']});
}
function query(q:string,dir:string) {
  const arr=JSON.parse(exec(['execute','DB','--command',q,'--json'],dir)) as
    Array<{success:boolean;results:Array<Record<string,unknown>>}>;
  expect(arr[0].success).toBe(true);
  return arr[0].results||[];
}
function fails(q:string,dir:string):string {
  try { query(q,dir); } catch(e) {
    const err=e as {stdout?:string;stderr?:string;message?:string};
    return [err.message,err.stdout,err.stderr].join('\n');
  }
  throw new Error('D1 permitiu um registro que deveria ser bloqueado.');
}

describe('CR JORNADA — politica de ponto por empresa no D1 local',()=>{
  it('impede marcacoes sem habilitacao, de outra empresa ou repetidas',()=>{
    const dir=mkdtempSync(join(tmpdir(),'cr-jornada-punch-policy-'));
    try {
      exec(['migrations','apply','DB'],dir);
      const fixture=join(dir,'fixture.sql');
      const statements=[
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-a','Empresa A','a','empresa-a',1760000000000,1760000000000)",
        "INSERT INTO companies(id,name,document,slug,created_at,updated_at) VALUES('co-b','Empresa B','b','empresa-b',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES('em-a','co-a','Pessoa A','100','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO employees(id,company_id,full_name,registration,admission_date,status,notes,created_at,updated_at) VALUES('em-b','co-b','Pessoa B','200','2026-01-01','active','',1760000000000,1760000000000)",
        "INSERT INTO company_punch_policies(company_id,enabled,rules_json,updated_at) VALUES('co-a',0,'{}',1760000000000)",
        "INSERT INTO work_days(id,employee_id,company_id,work_date,timezone,schedule_json,rules_json,created_at) VALUES('day-a','em-a','co-a','2026-10-19','America/Bahia','{}','{}',1760000000000)",
        "INSERT INTO work_days(id,employee_id,company_id,work_date,timezone,schedule_json,rules_json,created_at) VALUES('day-b','em-b','co-b','2026-10-19','America/Bahia','{}','{}',1760000000000)"
      ];
      writeFileSync(fixture,statements.join(';\n')+';\n','utf8');
      const result=JSON.parse(exec(['execute','DB','--file',fixture,'--json'],dir)) as
        Array<{success:boolean}>;
      expect(result.every(x=>x.success)).toBe(true);

      const punch=(id:string,day:string,employee:string,seq:number,type:string,key:string)=>
        "INSERT INTO punches(id,work_day_id,employee_id,seq,type,recorded_at,idempotency_key,ip_hash,receipt_hash)"+
        " VALUES('"+id+"','"+day+"','"+employee+"',"+seq+",'"+type+"',1792414800000,'"+key+"','ip-hash','receipt-hash')";
      expect(fails(punch('p-1','day-a','em-a',0,'entry','k1'),dir))
        .toMatch(/punch_policy_disabled/);
      query("UPDATE company_punch_policies SET enabled=1 WHERE company_id='co-a'",dir);
      query(punch('p-1','day-a','em-a',0,'entry','k1'),dir);
      expect(query("SELECT next_seq FROM work_days WHERE id='day-a'",dir))
        .toEqual([{next_seq:1}]);

      expect(fails(punch('p-2','day-a','em-b',1,'break_start','k2'),dir))
        .toMatch(/(?:punch_company_mismatch|employee_mismatch)/);
      expect(fails(punch('p-3','day-b','em-b',0,'entry','k3'),dir))
        .toMatch(/punch_policy_disabled/);
      expect(fails(punch('p-4','day-a','em-a',0,'entry','k4'),dir))
        .toMatch(/invalid_sequence/);
      expect(fails(punch('p-5','day-a','em-a',1,'break_start','k1'),dir))
        .toMatch(/(?:UNIQUE constraint failed|raw_punch_immutable)/i);

      query("UPDATE company_punch_policies SET enabled=0 WHERE company_id='co-a'",dir);
      expect(fails(punch('p-6','day-a','em-a',1,'break_start','k6'),dir))
        .toMatch(/punch_policy_disabled/);
      expect(query("SELECT id FROM punches WHERE work_day_id='day-a'",dir))
        .toEqual([{id:'p-1'}]);
      expect(query('PRAGMA foreign_key_check',dir)).toHaveLength(0);
    }finally{
      rmSync(dir,{recursive:true,force:true});
    }
  },240000);
});
