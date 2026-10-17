import {useMemo, useState, type CSSProperties} from 'react';
import {Activity, CalendarDays, HeartHandshake, RefreshCw, Users} from 'lucide-react';
import {brDate, localInput} from './api';
import {useData, useSession} from './layout';
import {Button, Empty, ErrorScreen, Field, PageHeader, Spinner} from './ui';

type Mood = 'very_happy' | 'good' | 'neutral' | 'sad' | 'stressed';

type MoodResponse = {
  employee_id: string;
  employee_name: string;
  mood_date: string;
  mood: Mood;
};

type MoodReport = {
  month: string;
  totals: Record<Mood, number>;
  responses: MoodResponse[];
  total_responses: number;
};

const options: {value: Mood; emoji: string; label: string; color: string}[] = [
  {value: 'very_happy', emoji: '😄', label: 'Muito feliz', color: '#208363'},
  {value: 'good', emoji: '🙂', label: 'Bem', color: '#4f9d82'},
  {value: 'neutral', emoji: '😐', label: 'Normal', color: '#84929e'},
  {value: 'sad', emoji: '😔', label: 'Triste', color: '#7185ae'},
  {value: 'stressed', emoji: '😣', label: 'Estressado', color: '#ae5561'}
];

const panel: CSSProperties = {
  background: 'var(--surface, #fff)',
  border: '1px solid #e6e9eb',
  borderRadius: 18,
  padding: 22,
  minWidth: 0
};

function emojiFor(mood: string): string {
  return options.find(item => item.value === mood)?.emoji ?? '—';
}

function labelFor(mood: string): string {
  return options.find(item => item.value === mood)?.label ?? 'Não informado';
}

function daysInMonth(value: string): number {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function percent(value: number, total: number): number {
  return total ? Math.round((value / total) * 100) : 0;
}

export function AdminMoodPage() {
  const {config} = useSession();
  const [month, setMonth] = useState(() =>
    localInput(config.server_now, config.timezone).slice(0, 7)
  );
  const [employeeId, setEmployeeId] = useState('all');
  const report = useData<MoodReport>(`/admin/mood?month=${month}`);
  const responses = report.data?.responses ?? [];

  const employees = useMemo(() => {
    const unique = new Map<string, string>();
    for (const item of responses) {
      unique.set(item.employee_id, item.employee_name);
    }
    return [...unique.entries()]
      .map(([id, name]) => ({id, name}))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [responses]);

  const filtered = useMemo(() =>
    employeeId === 'all'
      ? responses
      : responses.filter(row => row.employee_id === employeeId),
    [responses, employeeId]
  );

  const totals = useMemo(() => {
    const counts: Record<Mood, number> = {
      very_happy: 0,
      good: 0,
      neutral: 0,
      sad: 0,
      stressed: 0
    };
    for (const row of filtered) counts[row.mood] += 1;
    return counts;
  }, [filtered]);

  const calendarDays = useMemo(
    () => Array.from({length: daysInMonth(month)}, (_, i) => i + 1),
    [month]
  );

  const calendarEmployees = employeeId === 'all'
    ? employees
    : employees.filter(employee => employee.id === employeeId);

  const moodByEmployeeDay = useMemo(() => {
    const values = new Map<string, Mood>();
    for (const row of filtered) {
      values.set(`${row.employee_id}|${row.mood_date}`, row.mood);
    }
    return values;
  }, [filtered]);

  const top = options.reduce<(typeof options)[number] | null>((winner, option) => {
    if (!winner || totals[option.value] > totals[winner.value]) return option;
    return winner;
  }, null);
  const mainMood = filtered.length && top ? top : null;

  return (
    <>
      <PageHeader
        eyebrow="BEM-ESTAR DA EQUIPE"
        title="Humor da Equipe"
        description="Acompanhe as respostas voluntárias dos funcionários ao longo do mês."
        actions={
          <Button variant="secondary" icon={RefreshCw} onClick={report.reload} disabled={report.loading}>
            Atualizar
          </Button>
        }
      />

      <div className="filter-bar" style={{display: 'flex', flexWrap: 'wrap', gap: 14}}>
        <Field label="Mês de acompanhamento">
          <input
            type="month"
            min="2000-01"
            max="2100-12"
            value={month}
            onChange={event => {
              if (event.target.value) {
                setMonth(event.target.value);
                setEmployeeId('all');
              }
            }}
          />
        </Field>
        <Field label="Funcionário">
          <select
            value={employeeId}
            onChange={event => setEmployeeId(event.target.value)}
            style={{minHeight: 42, minWidth: 220}}
          >
            <option value="all">Toda a equipe</option>
            {employees.map(employee => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {report.loading ? (
        <Spinner label="Consultando os humores da equipe..." />
      ) : report.error ? (
        <ErrorScreen error={report.error} retry={report.reload} />
      ) : !responses.length ? (
        <section className="panel">
          <Empty
            icon={HeartHandshake}
            title="Nenhuma resposta registrada neste mês"
            text="Quando um funcionário responder após registrar a entrada, a resposta aparecerá aqui."
          />
        </section>
      ) : (
        <>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 18}}>
            <section style={panel}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, color: '#65717b'}}>
                <Activity size={18}/><span>Respostas no mês</span>
              </div>
              <div style={{fontSize: 34, fontWeight: 750, marginTop: 12}}>{filtered.length}</div>
              <small style={{color: '#64748b'}}>Uma resposta por funcionário e dia</small>
            </section>
            <section style={panel}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, color: '#65717b'}}>
                <Users size={18}/><span>Funcionários participantes</span>
              </div>
              <div style={{fontSize: 34, fontWeight: 750, marginTop: 12}}>
                {new Set(filtered.map(row => row.employee_id)).size}
              </div>
              <small style={{color: '#64748b'}}>Participação voluntária</small>
            </section>
            <section style={panel}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, color: '#65717b'}}>
                <HeartHandshake size={18}/><span>Humor mais frequente</span>
              </div>
              <div style={{fontSize: 25, fontWeight: 700, marginTop: 14}}>
                {mainMood ? `${mainMood.emoji} ${mainMood.label}` : '—'}
              </div>
              <small style={{color: '#64748b'}}>Entre as respostas recebidas</small>
            </section>
          </div>

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 18, marginBottom: 18}}>
            <section style={panel}>
              <h2 style={{fontSize: 19, margin: '0 0 6px'}}>Distribuição dos humores</h2>
              <p style={{color: '#64748b', fontSize: 13, margin: '0 0 24px'}}>
                Quantidade e percentual das respostas selecionadas.
              </p>
              <div style={{display: 'grid', gap: 18}}>
                {options.map(option => {
                  const count = totals[option.value];
                  const share = percent(count, filtered.length);
                  return (
                    <div key={option.value}>
                      <div style={{display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, marginBottom: 7}}>
                        <span>{option.emoji} {option.label}</span>
                        <strong>{count} · {share}%</strong>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={option.label}
                        aria-valuenow={share}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        style={{height: 12, borderRadius: 12, background: '#f0f2f4', overflow: 'hidden'}}
                      >
                        <div style={{height: '100%', width: `${share}%`, background: option.color, borderRadius: 12}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section style={panel}>
              <h2 style={{fontSize: 19, margin: '0 0 6px'}}>Últimas respostas</h2>
              <p style={{color: '#64748b', fontSize: 13, margin: '0 0 18px'}}>
                Histórico individual do mês selecionado.
              </p>
              {!filtered.length ? (
                <p style={{color: '#64748b'}}>Este funcionário ainda não respondeu neste mês.</p>
              ) : (
                <div style={{maxHeight: 340, overflowY: 'auto'}}>
                  {filtered.slice(0, 40).map(row => (
                    <div
                      key={`${row.employee_id}-${row.mood_date}`}
                      style={{display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #edf0f2'}}
                    >
                      <span style={{fontSize: 29}} aria-hidden="true">{emojiFor(row.mood)}</span>
                      <div style={{minWidth: 0, flex: 1}}>
                        <strong style={{display: 'block', fontSize: 13, overflowWrap: 'anywhere'}}>{row.employee_name}</strong>
                        <small style={{color: '#64748b'}}>{labelFor(row.mood)}</small>
                      </div>
                      <time style={{whiteSpace: 'nowrap', fontSize: 12, color: '#64748b'}} dateTime={row.mood_date}>
                        {brDate(row.mood_date)}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section style={panel}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6}}>
              <CalendarDays size={20} color="#8b101c"/>
              <h2 style={{fontSize: 19, margin: 0}}>Calendário mensal de humor</h2>
            </div>
            <p style={{color: '#64748b', fontSize: 13, marginTop: 0, marginBottom: 16}}>
              Cada emoji representa a resposta do funcionário naquele dia. O traço indica ausência de resposta, não um humor negativo.
            </p>
            {!calendarEmployees.length ? (
              <p style={{color: '#64748b'}}>Nenhum registro para o filtro selecionado.</p>
            ) : (
              <div style={{overflowX: 'auto', width: '100%'}}>
                <table className="data-table" style={{borderCollapse: 'separate', borderSpacing: 0, minWidth: 980, width: '100%'}}>
                  <thead>
                    <tr>
                      <th style={{position: 'sticky', left: 0, background: '#f8f9fa', minWidth: 190, zIndex: 1}}>
                        Funcionário
                      </th>
                      {calendarDays.map(day => (
                        <th key={day} style={{textAlign: 'center', minWidth: 34, padding: '10px 4px'}}>{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calendarEmployees.map(employee => (
                      <tr key={employee.id}>
                        <td style={{position: 'sticky', left: 0, background: '#fff', minWidth: 190, fontWeight: 600, zIndex: 1}}>
                          {employee.name}
                        </td>
                        {calendarDays.map(day => {
                          const date = `${month}-${String(day).padStart(2, '0')}`;
                          const mood = moodByEmployeeDay.get(`${employee.id}|${date}`);
                          return (
                            <td key={date} style={{textAlign: 'center', padding: '10px 4px', fontSize: mood ? 21 : 12}}
                              title={`${employee.name} — ${brDate(date)}: ${mood ? labelFor(mood) : 'Sem resposta'}`}>
                              {mood ? emojiFor(mood) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <p style={{marginTop: 20, color: '#64748b', fontSize: 12, lineHeight: 1.6}}>
        As respostas são opcionais e expressam apenas como a pessoa declarou estar se sentindo naquele momento.
        Elas não representam diagnóstico, avaliação de desempenho ou justificativa para medidas disciplinares.
        O acesso individual a estes dados deve permanecer restrito aos administradores autorizados.
      </p>
    </>
  );
}
