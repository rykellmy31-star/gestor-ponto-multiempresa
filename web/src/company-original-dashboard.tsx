import {useEffect,useState} from 'react';
import {AlertTriangle,ArrowUpRight,CheckCircle2,Clock3,Coffee,
  FileSpreadsheet,LogIn,MessageSquareText,RefreshCw,Search,
  ShieldCheck,UserRoundX,Users} from 'lucide-react';
import {jsonRequest,isExpiredCompanySession} from './company-schedules-network';
import {Button,Empty,Initials,PageHeader,Stat} from './ui';

type EmployeeDay={employee:{id:string;full_name:string;registration:string};
  day:{status:string;timezone:string;marks:(number|null)[];worked_minutes:number;next_seq:number}};
type Dashboard={company_id:string;date:string;month:string;rows:EmployeeDay[];
  trend:Array<{date:string;worked_minutes:number}>;
  counts:{active_employees:number;entered:number;not_entered:number;on_break:number;
    completed:number;incomplete:number|null;late_employees:number|null;
    pending:number|null;worked_minutes:number}};
const hm=(n:number)=>Math.floor(n/60).toString().padStart(2,'0')+':'+
  Math.floor(n%60).toString().padStart(2,'0');
const localDate=(zone:string)=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=(key:string)=>parts.find(p=>p.type===key)?.value||'';
  return value('year')+'-'+value('month')+'-'+value('day');
};
const dayDate=(date:string)=>date.split('-').reverse().join('/');
const statusNames:Record<string,string>={working:'Em expediente',on_break:'Em intervalo',
  completed:'Encerrado',not_started:'Não iniciado',inactive:'Inativo'};
function clock(value:number|null,zone:string){
  if(value===null)return '—';
  return new Intl.DateTimeFormat('pt-BR',{
    timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false
  }).format(value);
}

export function CompanyOriginalOverview({companyId,timezone,onNavigate,onSessionExpired}:{
  companyId:string;timezone:string;
  onNavigate:(view:string)=>void;onSessionExpired:()=>void;
}){
  const [date,setDate]=useState(()=>localDate(timezone));
  const [month,setMonth]=useState(()=>localDate(timezone).slice(0,7));
  const [data,setData]=useState<Dashboard|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [reload,setReload]=useState(0),[search,setSearch]=useState('');
  const [status,setStatus]=useState('all');
  useEffect(()=>{
    const ctrl=new AbortController();
    setLoading(true);setError('');setData(null);
    jsonRequest<Dashboard>('/company/reports/overview?'+new URLSearchParams({date,month}),
      {signal:ctrl.signal}).then(result=>{
      if(ctrl.signal.aborted)return;
      if(result.company_id!==companyId||result.date!==date||result.month!==month)
        throw new Error('A consulta retornou dados fora do contexto da sua empresa.');
      setData(result);
    }).catch(err=>{
      if(ctrl.signal.aborted)return;
      if(isExpiredCompanySession(err)){onSessionExpired();return;}
      setError(err instanceof Error?err.message:'Não foi possível consultar o painel.');
    }).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[companyId,date,month,reload,onSessionExpired]);
  const filtered=(data?.rows||[]).filter(item=>
    (item.employee.full_name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))||
     item.employee.registration.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) &&
    (status==='all'||status===item.day.status));
  const max=Math.max(60,...(data?.trend||[]).map(i=>i.worked_minutes));
  return <>
    <PageHeader eyebrow="PAINEL DA EMPRESA" title="Visão geral"
      description="Uma visão clara da jornada da sua equipe, todos os dias."
      actions={<Button variant="secondary" icon={RefreshCw} busy={loading}
        onClick={()=>setReload(v=>v+1)}>Atualizar</Button>}/>
    <div className="filter-bar dashboard-filters">
      <label className="field"><span className="field-label">Data de acompanhamento</span>
        <input aria-label="Data de acompanhamento" type="date"
          value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/>
      </label>
      <label className="field"><span className="field-label">Mês dos indicadores de horas</span>
        <input aria-label="Mês dos indicadores de horas" type="month"
          value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/>
      </label>
      <div className="filter-hint"><span className="live-dot"/> Dados consultados no banco D1 da empresa</div>
    </div>
    {loading&&<section className="panel" style={{padding:22}}>Consultando indicadores da equipe…</section>}
    {error&&<section className="panel" role="alert" style={{padding:22}}>
      <p>{error}</p><Button variant="secondary" onClick={()=>setReload(v=>v+1)}>Tentar novamente</Button>
    </section>}
    {data&&<>
      <div className="stats-grid">
        <Stat label="Funcionários ativos" value={data.counts.active_employees} icon={Users} detail="Vínculos ativos na empresa"/>
        <Stat label="Já registraram entrada" value={data.counts.entered} icon={LogIn} detail="Expediente iniciado" tone="green"/>
        <Stat label="Aguardando entrada" value={data.counts.not_entered} icon={UserRoundX} detail="Ativos sem registro de entrada" tone="orange"/>
        <Stat label="Em intervalo" value={data.counts.on_break} icon={Coffee} detail="Pausa registrada" tone="purple"/>
        <Stat label="Expedientes encerrados" value={data.counts.completed} icon={CheckCircle2} detail="Quatro marcações confirmadas" tone="green"/>
        <Stat label="Registros incompletos" value={data.counts.incomplete??'—'} icon={AlertTriangle} detail="Indicador aguarda reconciliação" tone="orange"/>
        <Stat label="Análises pendentes" value={data.counts.pending??'—'} icon={MessageSquareText} detail="Solicitações ainda em integração" tone="purple"/>
        <Stat label="Horas realizadas no mês" value={hm(data.counts.worked_minutes)} icon={Clock3} detail="Apenas intervalos confirmados"/>
      </div>
      <div className="dashboard-middle">
        <section className="panel activity-panel">
          <div className="panel-header">
            <div><h3>Horas realizadas no período</h3><p>Tempo registrado por dia · {month.slice(5)}/{month.slice(0,4)}</p></div>
            <span className="chart-legend"><i/> Horas trabalhadas</span>
          </div>
          {data.trend.some(v=>v.worked_minutes>0)?
          <div className="chart-container">
            <div className="bar-chart">{data.trend.map(v=>
              <div className="chart-col" key={v.date} title={dayDate(v.date)+': '+hm(v.worked_minutes)}>
                <div><i style={{height:Math.max(v.worked_minutes?3:0,v.worked_minutes/max*100)+'%'}}/></div>
                <span>{v.date.slice(8)}</span>
              </div>)}</div>
            <p className="chart-note">Somente marcações confirmadas, sem simular tempo de turno aberto.</p>
          </div>:
          <Empty icon={Clock3} title="O período ainda não tem horas registradas"
            text="O gráfico será preenchido conforme os funcionários registrarem pontos."/>}
        </section>
        <section className="dashboard-tip">
          <div className="tip-icon"><ShieldCheck size={25}/></div>
          <div className="eyebrow">CONFERÊNCIA RESPONSÁVEL</div>
          <h3>O fechamento começa com bons registros.</h3>
          <p>Confira marcações, analise ocorrências e os intervalos antes de fechar o mês.</p>
          <button className="text-link cr-link-button" onClick={()=>onNavigate('reports')}>
            Conferir folhas <ArrowUpRight size={17}/>
          </button>
        </section>
      </div>
      <section className="panel team-today">
        <div className="panel-header">
          <div><h3>Jornada da equipe</h3>
            <p>{dayDate(date)} · {filtered.length} funcionário(s) na consulta</p></div>
          <button className="text-link cr-link-button" onClick={()=>onNavigate('records')}>
            Ver registros <ArrowUpRight size={15}/>
          </button>
        </div>
        <div className="table-toolbar">
          <div className="search-input"><Search size={17}/>
            <input aria-label="Buscar funcionário" value={search}
              onChange={e=>setSearch(e.target.value)} placeholder="Buscar nome ou matrícula…"/>
          </div>
          <select aria-label="Filtrar situação" value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="all">Todas as situações</option>
            <option value="working">Em expediente</option>
            <option value="on_break">Em intervalo</option>
            <option value="completed">Encerrado</option>
            <option value="not_started">Não iniciado</option>
            <option value="inactive">Inativo</option>
          </select>
        </div>
        {!filtered.length?
          <Empty icon={Users} title={data.rows.length?'Nenhum funcionário neste filtro':'Sua equipe começa aqui'}
            text={data.rows.length?'Tente outro nome ou situação.':'Cadastre seu primeiro funcionário.'}/>:
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Funcionário</th><th>Situação</th><th>Entrada</th>
              <th>Intervalo</th><th>Retorno</th><th>Saída</th><th>Realizadas</th></tr></thead>
            <tbody>{filtered.map(r=><tr key={r.employee.id}>
              <td><div className="person-cell"><Initials name={r.employee.full_name}/>
                <div><strong>{r.employee.full_name}</strong>
                <small>Matrícula {r.employee.registration}</small></div></div></td>
              <td><span className={'badge badge-'+r.day.status}>
                {statusNames[r.day.status]||r.day.status}</span></td>
              {r.day.marks.map((m,i)=><td key={i} className="number">{clock(m,r.day.timezone)}</td>)}
              <td className="number strong">{hm(r.day.worked_minutes)}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <div className="cr-overview-footnote"><FileSpreadsheet size={15}/>
        O painel apresenta marcações confirmadas e não substitui a apuração mensal definitiva.</div>
    </>}
  </>;
}
