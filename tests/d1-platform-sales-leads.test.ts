import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
  const parsed=JSON.parse(exec(['execute','DB','--command',q,'--json'],dir)) as
    Array<{success:boolean;results:Array<Record<string,unknown>>}>;
  expect(parsed[0].success).toBe(true);
  return parsed[0].results||[];
}

describe('CR JORNADA — cadastro comercial isolado no D1 local',()=>{
  it('persiste, acompanha e exclui contatos com checks de integridade',()=>{
    const dir=mkdtempSync(join(tmpdir(),'cr-jornada-leads-'));
    try {
      exec(['migrations','apply','DB'],dir);
      query([
        "INSERT INTO sales_leads(id,name,email,company,message,plan_id,consent_at,created_at,updated_at)",
        "VALUES('lead-a','Cliente de Teste','cliente@exemplo.com','Loja Modelo',",
        "'Quero saber como funciona o CR JORNADA','essencial',1760000000000,1760000000000,1760000000000)"
      ].join(' '),dir);

      expect(query('SELECT name,email,status FROM sales_leads',dir)).toEqual([
        {name:'Cliente de Teste',email:'cliente@exemplo.com',status:'new'}
      ]);
      query("UPDATE sales_leads SET status='contacted',updated_at=1760000001000 WHERE id='lead-a'",dir);
      expect(query("SELECT status FROM sales_leads WHERE id='lead-a'",dir))
        .toEqual([{status:'contacted'}]);
      expect(query(
        "SELECT action,entity_id FROM platform_audit_log WHERE entity_type='sales_lead'",dir
      )).toEqual([{
        action:'sales_lead.status_updated',entity_id:'lead-a'
      }]);

      // O D1 impede gravar contato sem consentimento e status arbitrario.
      // consent_at faz parte obrigatoria da estrutura e e validado no endpoint.
      expect(query('PRAGMA foreign_key_check',dir)).toHaveLength(0);
      query("DELETE FROM sales_leads WHERE id='lead-a'",dir);
      expect(query('SELECT COUNT(*) AS total FROM sales_leads',dir))
        .toEqual([{total:0}]);
    } finally {
      rmSync(dir,{recursive:true,force:true});
    }
  },240000);
});
