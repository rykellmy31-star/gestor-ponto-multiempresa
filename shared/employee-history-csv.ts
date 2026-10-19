export type EmployeeHistory = {
  month: string;
  company_id: string;
  employee_id: string;
  days: Array<{
    date: string;
    punches: Array<{
      id: string;
      seq: number;
      type: 'entry' | 'break_start' | 'break_end' | 'exit';
      recorded_at: number;
      receipt_hash: string | null;
    }>;
  }>;

};

const labels = {
  entry: 'Entrada', break_start: 'Início do intervalo',
  break_end: 'Fim do intervalo', exit: 'Saída'
};

function cell(value: string | number | null): string {
  let text = String(value ?? '');
  // Aspas não impedem fórmulas ao abrir CSV em planilhas.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

// Extrato informativo dos dados já autorizados na API de histórico.
// Não inclui CPF, IP, tokens, idempotência ou apuração de folha.
export function employeeHistoryCsv(history: EmployeeHistory, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const rows: Array<Array<string | number | null>> = [[
    'Empresa (ID)', 'Funcionário (ID)', 'Dia de trabalho', 'Sequência',
    'Marcação', 'Horário local', 'Fuso horário', 'Instante UTC',
    'Registro (ID)', 'Identificação técnica'
  ]];
  for (const day of history.days) {
    for (const punch of day.punches) {
      rows.push([
        history.company_id, history.employee_id, day.date, punch.seq + 1,
        labels[punch.type], formatter.format(punch.recorded_at), timezone,
        new Date(punch.recorded_at).toISOString(), punch.id, punch.receipt_hash
      ]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
}
