import { describe, expect, it } from 'vitest';
import { employeeHistoryCsv, type EmployeeHistory } from '../shared/employee-history-csv';

function history(): EmployeeHistory {
  return {month:'2026-10',company_id:'empresa-a',employee_id:'pessoa-a',days:[{
    date:'2026-10-19',punches:[{id:'registro-a',seq:0,type:'entry',
      recorded_at:Date.UTC(2026,9,19,12,2,3),receipt_hash:'hash-tecnico'}]
  }]};
}

describe('Extrato CSV pessoal', () => {
  it('mantém horário da empresa, instante UTC e identificação técnica', () => {
    const csv = employeeHistoryCsv(history(),'America/Bahia');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"09:02:03";"America/Bahia";"2026-10-19T12:02:03.000Z"');
    expect(csv).toContain('"2026-10-19";"1";"Entrada"');
    expect(csv).toContain('"registro-a";"hash-tecnico"');
    expect(csv.split('\r\n')).toHaveLength(3);
    for (const secret of ['CPF','ip_hash','idempotency_key','csrf','token'])
      expect(csv).not.toContain(secret);
  });
  it('escapa aspas, delimitadores e fórmulas de planilha', () => {
    const h = history();
    h.company_id = ' \t=HYPERLINK("https://example.com")';
    h.employee_id = 'pessoa;"teste"';
    const csv = employeeHistoryCsv(h,'America/Sao_Paulo');
    expect(csv).toContain('"\' \t=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"pessoa;""teste"""');
  });
  it('não inventa marcações para dias vazios', () => {
    const h = history();h.days[0].punches=[];
    expect(employeeHistoryCsv(h,'America/Bahia').split('\r\n')).toHaveLength(2);
  });
  it('aceita identificação técnica ausente sem escrever null', () => {
    const h=history();h.days[0].punches[0].receipt_hash=null;
    expect(employeeHistoryCsv(h,'America/Bahia')).toContain('"registro-a";""\r\n');
  });
});
