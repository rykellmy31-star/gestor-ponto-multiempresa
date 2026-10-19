import { useEffect, useState } from 'react';
import { CalendarDays, FileClock, RefreshCw } from 'lucide-react';

type Punch = {
  id: string;
  seq: number;
  type: 'entry' | 'break_start' | 'break_end' | 'exit';
  recorded_at: number;
  receipt_hash: string | null;
};
type WorkDay = {
  date: string;
  next_seq: number;
  punches: Punch[];
};
type HistoryPayload = {
  success: boolean;
  month: string;
  company_id: string;
  employee_id: string;
  days: WorkDay[];
};

const labels: Record<Punch['type'], string> = {
  entry: 'Entrada', break_start: 'Início do intervalo',
  break_end: 'Fim do intervalo', exit: 'Saída'
};

function currentMonth() {
  // Apenas a escolha inicial do filtro: todas as datas consultadas
  // sao provenientes do servidor e do banco com company_id isolado.
  const date = new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function formatTime(timestamp: number, zone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(timestamp));
}

export function EmployeeCpfPointHistory({
  timezone, refreshVersion = 0
}: {
  timezone?: 'America/Bahia' | 'America/Sao_Paulo';
  refreshVersion?: number;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setHistory(null);
    setLoading(true);
    setError('');

    fetch('/api/employee/cpf-work/history?month=' + encodeURIComponent(month), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal
    }).then(async response => {
      if (!response.ok) {
        if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente.');
        if (response.status === 403) throw new Error('Altere sua senha inicial antes de consultar o ponto.');
        throw new Error('O histórico não está disponível. Tente novamente.');
      }
      return response.json() as Promise<HistoryPayload>;
    }).then(payload => {
      if (!ctrl.signal.aborted) setHistory(payload);
    }).catch(err => {
      if (!ctrl.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Não foi possível consultar o ponto.');
      }
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false);
    });

    return () => ctrl.abort();
  }, [month, reload, refreshVersion]);

  const zone = timezone || 'America/Bahia';
  return <section style={{
    border: '1px solid #eee0e0', borderRadius: 12,
    background: '#fff', padding: 18, marginBottom: 20
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <FileClock size={19} color="#800000"/>
      <h3 style={{ fontSize: 16, margin: 0 }}>Meu histórico de ponto</h3>
    </div>
    <p style={{ color: '#7c7274', fontSize: 12, lineHeight: 1.6, marginBottom: 15 }}>
      Consulte suas marcações registradas nesta empresa.
      A consulta não permite editar os horários.
    </p>
    <div style={{ display: 'flex', gap: 9, alignItems: 'end', flexWrap: 'wrap', marginBottom: 17 }}>
      <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
        Mês de referência
        <input aria-label="Mês de referência" type="month"
          min="2000-01" max="2099-12" value={month}
          onChange={e => setMonth(e.target.value)}
          style={{
            minHeight: 38, padding: '7px 10px', border: '1px solid #d8cece',
            borderRadius: 8, fontSize: 13, color: '#322'
          }}/>
      </label>
      <button type="button" onClick={() => setReload(v => v + 1)}
        aria-label="Atualizar histórico" style={{
          minHeight: 38, padding: '9px 12px', border: '1px solid #e8dbdb',
          borderRadius: 8, background: '#faf7f7', color: '#800000',
          display: 'flex', alignItems: 'center', gap: 6
        }}><RefreshCw size={16}/> Atualizar</button>
    </div>

    {loading && <p role="status" style={{ fontSize: 12 }}>Carregando histórico…</p>}
    {error && <p role="alert" style={{ color: '#9d2929', fontSize: 12 }}>{error}</p>}
    {!loading && !error && history?.days.length === 0 && <p style={{
      color: '#83787b', fontSize: 12, display: 'flex', gap: 7,
      alignItems: 'center'
    }}><CalendarDays size={16}/> Nenhuma marcação encontrada neste mês.</p>}
    {history?.days.map(day => <article key={day.date} style={{
      borderTop: '1px solid #f1e7e7', padding: '12px 0'
    }}>
      <strong style={{ fontSize: 13 }}>
        {day.date.slice(8, 10)}/{day.date.slice(5, 7)}/{day.date.slice(0, 4)}
      </strong>
      {day.punches.length === 0
        ? <p style={{ marginTop: 5, fontSize: 12, color: '#8b8082' }}>Sem marcações neste dia.</p>
        : <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
          {day.punches.map(punch => <div key={punch.id} style={{
            display: 'flex', justifyContent: 'space-between',
            gap: 12, fontSize: 12
          }}>
            <span style={{ color: '#847578' }}>{labels[punch.type]}</span>
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <strong>{formatTime(punch.recorded_at, zone)}</strong>
              {punch.receipt_hash && <details style={{ marginTop: 5, maxWidth: 250 }}>
                <summary style={{ cursor: 'pointer', fontSize: 11, color: '#800000' }}>
                  Identificação do registro
                </summary>
                <code style={{ display: 'block', wordBreak: 'break-all', marginTop: 5,
                  color: '#70646b', fontSize: 10, fontWeight: 400 }}>
                  {punch.receipt_hash}
                </code>
              </details>}
            </div>
          </div>)}
        </div>}
    </article>)}
  </section>;
}
