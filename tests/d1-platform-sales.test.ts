import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrangler = join(process.cwd(), 'node_modules', '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
function exec(args: string[], dir: string): string {
  return execFileSync(wrangler, [
    'd1', ...args, '--config', 'wrangler.jsonc', '--local', '--persist-to', dir
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'] });
}
function sql(q: string, dir: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(exec(['execute', 'DB', '--command', q, '--json'], dir)) as
    Array<{ success: boolean; results: Array<Record<string, unknown>> }>;
  expect(parsed[0].success).toBe(true);
  return parsed[0].results || [];
}
describe('CR JORNADA - vendas e publicacao no D1 local', () => {
  it('nao vaza rascunhos, permite publicacao e audita mudancas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-jornada-sales-page-'));
    try {
      exec(['migrations', 'apply', 'DB'], dir);
      const file = join(dir, 'fixture.sql');
      const statements = [
        "INSERT INTO platform_admins(id,login,display_name,password_hash,created_at,updated_at) VALUES ('admin-teste','superadmin-teste','Admin Teste','hash-teste',1760000000000,1760000000000)",
        "INSERT INTO sales_page_settings(id,draft_json,published_json,published,revision,updated_by,updated_at) VALUES(1,'{\"headline\":\"Rascunho\"}',NULL,0,1,'admin-teste',1760000000000)"
      ];
      writeFileSync(file, statements.join(';\n')+';\n');
      const inserted = JSON.parse(exec(['execute', 'DB', '--file', file, '--json'], dir));
      expect(inserted.every((row:{success:boolean})=>row.success)).toBe(true);

      expect(sql('SELECT published,published_json FROM sales_page_settings WHERE id=1', dir))
        .toEqual([{ published: 0, published_json: null }]);

      sql("UPDATE sales_page_settings SET draft_json='{\"headline\":\"Versao A\"}',published_json='{\"headline\":\"Versao A\"}',published=1,revision=2,updated_at=1760000001000 WHERE id=1 AND revision=1", dir);
      expect(sql('SELECT published,revision,json_extract(published_json,\'$.headline\') AS title FROM sales_page_settings WHERE id=1', dir))
        .toEqual([{ published: 1, revision: 2, title: 'Versao A' }]);

      // Novo rascunho nao afeta a versao publicada.
      sql("UPDATE sales_page_settings SET draft_json='{\"headline\":\"Versao B\"}',revision=3,updated_at=1760000002000 WHERE id=1 AND revision=2", dir);
      expect(sql('SELECT json_extract(draft_json,\'$.headline\') AS draft,json_extract(published_json,\'$.headline\') AS live FROM sales_page_settings WHERE id=1', dir))
        .toEqual([{ draft: 'Versao B', live: 'Versao A' }]);

      // A pagina pode ser retirada do ar mantendo o rascunho.
      sql('UPDATE sales_page_settings SET published=0,revision=4,updated_at=1760000003000 WHERE id=1 AND revision=3', dir);
      expect(sql('SELECT published,revision FROM sales_page_settings WHERE id=1', dir))
        .toEqual([{ published: 0, revision: 4 }]);

      const audit = sql(
        "SELECT action FROM platform_audit_log WHERE entity_type='sales_page' ORDER BY created_at", dir
      );
      expect(audit.map(x=>x.action)).toEqual([
        'sales_page.draft_saved',
        'sales_page.published',
        'sales_page.draft_saved',
        'sales_page.unpublished'
      ]);
      expect(sql('PRAGMA foreign_key_check', dir)).toHaveLength(0);

      // UPSERT usado pela API: insercao inicial so aceita revisao zero,
      // mas edicoes legitimas da pagina (revisao positiva) devem funcionar.
      const publishedJson = '{"headline":"Versao C"}';
      const upsert = (expected: number) => [
        'INSERT INTO sales_page_settings(',
        'id,draft_json,published_json,published,revision,updated_by,updated_at',
        ') SELECT 1,',
        "'" + publishedJson + "','" + publishedJson + "',1,1,'admin-teste',1760000004000",
        'WHERE (' + expected + '=0 OR EXISTS(',
        'SELECT 1 FROM sales_page_settings WHERE id=1))',
        'ON CONFLICT(id) DO UPDATE SET',
        'draft_json=excluded.draft_json,',
        'published_json=excluded.draft_json,',
        'published=1,revision=sales_page_settings.revision+1,',
        'updated_by=excluded.updated_by,updated_at=excluded.updated_at',
        'WHERE sales_page_settings.revision=' + expected
      ].join(' ');

      sql(upsert(4), dir);
      expect(sql("SELECT revision,json_extract(published_json,'$.headline') AS title FROM sales_page_settings", dir))
        .toEqual([{ revision: 5, title: 'Versao C' }]);
      // Aba desatualizada nao sobrescreve a revisao 5.
      sql(upsert(4), dir);
      expect(sql('SELECT revision FROM sales_page_settings', dir))
        .toEqual([{ revision: 5 }]);
      sql('DELETE FROM sales_page_settings WHERE id=1', dir);
      sql(upsert(5), dir);
      expect(sql('SELECT COUNT(*) AS total FROM sales_page_settings', dir))
        .toEqual([{ total: 0 }]);
      sql(upsert(0), dir);
      expect(sql('SELECT revision FROM sales_page_settings', dir))
        .toEqual([{ revision: 1 }]);

    } finally {
      rmSync(dir, { recursive:true, force:true });
    }
  }, 240000);
});
