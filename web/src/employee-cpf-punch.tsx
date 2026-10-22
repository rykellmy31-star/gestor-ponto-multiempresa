import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, CheckCircle2, RefreshCw, ShieldCheck, LogIn, Coffee, RotateCcw, LogOut, ArrowRight, LockKeyhole, CalendarDays } from 'lucide-react';
import './employee-cpf-punch.css';
import {nextEmployeePunchAttempt,matchesEmployeePunchConfirmation,
  checkEmployeePunchPreflight,
  type PendingEmployeePunch} from './employee-cpf-ui-safety';

type PunchType = 'entry'|'break_start'|'break_end'|'exit';
type Confirmation = {
  id: string;
  type: PunchType;
  recorded_at: number;
  work_date: string;
  receipt_hash: string;
};
type Today = {
  company_id:string; employee_id:string; work_date:string;
  next_seq:number; next_type:PunchType|null; completed:boolean;
  server_now:number;
  timezone?:string;can_punch?:boolean;blocked?:{code:string;message:string}|null;schedule_name?:string|null;
  schedule?:{start:string;break_start:string;break_end:string;end:string;paid_break:boolean}|null;
  expected_minutes?:number;worked_minutes?:number;break_minutes?:number;
  punches?:Array<{id:string;seq:number;type:PunchType;recorded_at:number}>;
};
const descriptions:Record<PunchType,string> = {
  entry:'Registrar entrada',
  break_start:'Iniciar intervalo',
  break_end:'Terminar intervalo',
  exit:'Registrar saída'
};

export function EmployeeCpfPunch({
  companyId, employeeId, csrfToken, timezone = 'America/Bahia',
  onConfirmed, onSessionExpired
}: {
  companyId:string;
  employeeId:string;
  csrfToken:string;
  timezone?: 'America/Bahia' | 'America/Sao_Paulo';
  onConfirmed?:()=>void;
  onSessionExpired?:()=>void;
}) {
  const [today,setToday]=useState<Today|null>(null);
  const [now,setNow]=useState(Date.now());
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [disabled,setDisabled]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [lastConfirmation,setLastConfirmation]=useState<Confirmation|null>(null);
  // Enquanto a confirmacao nao vier, reutiliza a MESMA chave no retry.
  const pendingKey=useRef<PendingEmployeePunch|null>(null);
  useEffect(()=>{
    const base=today?.server_now||Date.now();
    const started=performance.now();
    setNow(base);
    const timer=setInterval(()=>setNow(base+performance.now()-started),1000);
    return ()=>clearInterval(timer);
  },[today?.server_now]);

  const load=useCallback(async()=>{
    setLoading(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/employee/cpf-work/today',{
        credentials:'same-origin',cache:'no-store'
      });
      if(response.status===503){
        setToday(null);setDisabled(true);return;
      }
      if(response.status===401){
        setToday(null);onSessionExpired?.();return;
      }
      if(!response.ok){
        const failure=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
        throw new Error(failure?.error?.message||'Não foi possível consultar sua jornada. Tente novamente.');
      }
      const data=await response.json() as Today;
      if(data.company_id!==companyId||data.employee_id!==employeeId){
        throw new Error('A empresa da sessão mudou. Entre novamente.');
      }
      // A linha do tempo usa somente o historico autenticado da mesma empresa.
      // Falha nessa consulta nao libera outra batida nem altera a ordem autorizada.
      let hydrated=data;
      try{
        const historyResponse=await fetch('/api/employee/cpf-work/history?month='+
          encodeURIComponent(data.work_date.slice(0,7)),{
            credentials:'same-origin',cache:'no-store'
          });
        if(historyResponse.status===401){
          setToday(null);onSessionExpired?.();return;
        }
        if(historyResponse.ok){
          const history=await historyResponse.json() as {
            company_id:string;employee_id:string;
            days:Array<{date:string;punches:Array<{id:string;seq:number;
              type:PunchType;recorded_at:number}>}>
          };
          if(history.company_id!==companyId||history.employee_id!==employeeId)
            throw new Error('O histórico retornou outra empresa ou funcionário.');
          const punches=history.days.find(day=>day.date===data.work_date)?.punches||[];
          const time=(seq:number)=>punches.find(p=>p.seq===seq)?.recorded_at;
          const first=time(0)!=null&&time(1)!=null?Math.max(0,time(1)!-time(0)!):0;
          const second=time(2)!=null&&time(3)!=null?Math.max(0,time(3)!-time(2)!):0;
          const pause=time(1)!=null&&time(2)!=null?Math.max(0,time(2)!-time(1)!):0;
          hydrated={...data,punches,worked_minutes:Math.floor((first+second)/60000),
            break_minutes:Math.floor(pause/60000)};
        }
      }catch(error){
        if(error instanceof Error&&error.message.includes('outra empresa'))
          throw error;
      }
      setToday(hydrated);setDisabled(false);
    }catch(e){
      setToday(null);
      setError(e instanceof Error?e.message:'Falha ao consultar.');
    }finally{setLoading(false);}
  },[companyId,employeeId,onSessionExpired]);

  // Renderiza o modulo mesmo que ainda esteja desligado. A requisicao
  // so acontece depois da autenticacao confirmada do funcionario.
  useEffect(()=>{
    pendingKey.current=null;
    setLastConfirmation(null);
    void load();
  },[load]);

  async function punch(){
    const type=today?.next_type;
    if(!type||busy||disabled||today?.can_punch===false)return;
    const expected={companyId,employeeId,workDate:today!.work_date,type};
    setBusy(true);setError('');setNotice('');
    try{
      // Confere a data e a proxima batida diretamente na API: uma tela
      // deixada aberta durante a noite nao pode criar ponto no dia errado.
      const check=await fetch('/api/employee/cpf-work/today',{
        credentials:'same-origin',cache:'no-store'
      });
      if(check.status===401){onSessionExpired?.();return;}
      if(!check.ok)throw new Error('Não foi possível confirmar a jornada atual. Atualize a tela antes de registrar.');
      const fresh=await check.json() as Today;
      if(fresh.can_punch===false){setToday(fresh);throw new Error(fresh.blocked?.message||'Registro indisponível.');}
      const verdict=checkEmployeePunchPreflight(expected,fresh,pendingKey.current);
      if(verdict==='different_identity'){
        setToday(null);pendingKey.current=null;
        throw new Error('A sessão mudou de empresa ou funcionário. Entre novamente.');
      }
      if(verdict==='changed'){
        setToday(fresh);pendingKey.current=null;
        throw new Error('O dia ou a sequência de ponto mudou. Confira o próximo registro antes de continuar.');
      }
      const attempt=nextEmployeePunchAttempt(pendingKey.current,expected,
        ()=>crypto.randomUUID());
      pendingKey.current=attempt;
      const key=attempt.key;
      const response=await fetch('/api/employee/cpf-work/punch',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{
          'Content-Type':'application/json','X-CSRF-Token':csrfToken
        },
        body:JSON.stringify({type,idempotency_key:key})
      });
      if(response.status===401){onSessionExpired?.();return;}
      const data=await response.json().catch(()=>null) as
        {success?:boolean;replayed?:boolean;punch?:Confirmation;
          error?:{message?:string}}|null;
      if(!response.ok||!data?.success||!data.punch){
        throw new Error(data?.error?.message||
          'Não foi possível confirmar o ponto. Confira e tente novamente.');
      }
      if(!matchesEmployeePunchConfirmation(data.punch,attempt)){
        // Uma confirmacao antiga (p.ex. de ontem) nunca vira um
        // comprovante de hoje, mesmo se o servidor responder replay.
        pendingKey.current=null;
        await load();
        throw new Error('A confirmação não corresponde ao ponto de hoje. Confira o histórico antes de registrar novamente.');
      }
      pendingKey.current=null;
      setLastConfirmation(data.punch);
      setNotice(data.replayed
        ? 'Registro anteriormente confirmado. Nenhuma marcação duplicada.'
        : 'Ponto registrado com sucesso.');
      onConfirmed?.();
      await load();
      setNotice(data.replayed
        ? 'Registro anteriormente confirmado. Nenhuma marcação duplicada.'
        : 'Ponto registrado com sucesso.');
    }catch(e){
      // Nao trocar a chave: se houve falha de rede apos a gravacao,
      // a proxima tentativa deve obter a confirmacao anterior.
      setError(e instanceof Error?e.message:'Erro ao confirmar.');
    }finally{setBusy(false);}
  }
  const zone=today?.timezone||timezone;
  const marks=([['entry','Entrada',LogIn],['break_start','Saída para intervalo',Coffee],
    ['break_end','Retorno do intervalo',RotateCcw],['exit','Saída final',LogOut]] as const);
  const format=(value:number,seconds=false)=>new Intl.DateTimeFormat('pt-BR',{
    timeZone:zone,hour:'2-digit',minute:'2-digit',
    ...(seconds?{second:'2-digit'}:{}),hour12:false
  }).format(new Date(value));
  const totalMinutes=(value:number)=>Math.floor(value/60).toString().padStart(2,'0')+':'+
    Math.floor(value%60).toString().padStart(2,'0');
  const sequence=today?.next_seq??0;
  const livePunch=sequence===1?today?.punches?.find(p=>p.seq===0)?.recorded_at:
    sequence===3?today?.punches?.find(p=>p.seq===2)?.recorded_at:undefined;
  const worked=(today?.worked_minutes||0)+(livePunch?Math.max(0,Math.floor((now-livePunch)/60000)):0);
  const dateText=new Intl.DateTimeFormat('pt-BR',{
    timeZone:zone,weekday:'long',day:'2-digit',month:'long',year:'numeric'
  }).format(new Date(now));
  const entries=today?.punches||[];
  return <div className="clock-layout cr-employee-original-clock" aria-label="Registro de ponto">
    <section className="panel punch-panel">
      <div className="panel-header"><span className="section-label">
        <span className="live-dot"/> REGISTRO DE PONTO
      </span><ShieldCheck size={19}/></div>
      <div className="clock-face">
        <p className="clock-date">{dateText}</p>
        <div className="digital-clock" aria-label="Relógio">{format(now,true)}</div>
        <div className="clock-sync"><ShieldCheck size={13}/>
          {today?'Referência de horário do servidor':'Relógio do dispositivo — registro indisponível'} · {zone}
        </div>
      </div>
      <div className="punch-progress">
        {marks.map(([kind,label],i)=><div key={kind}
          className={today&&sequence>i?'done':today&&sequence===i?'current':''}>
          <span>{today&&sequence>i?<CheckCircle2 size={17}/>:i+1}</span>
          <small>{['Entrada','Intervalo','Retorno','Saída'][i]}</small>
        </div>)}
      </div>
      <div className="punch-buttons">
        {marks.map(([kind,label,Icon],i)=>{
          const enabled=Boolean(today&&today.next_type===kind&&today.can_punch!==false&&!busy&&!loading&&!disabled);
          const done=Boolean(today&&sequence>i);
          return <button key={kind} type="button"
            className={'punch-button '+(enabled?'punch-enabled':'')+(done?' punch-done':'')}
            disabled={!enabled} onClick={()=>void punch()}>
            <span className="punch-button-icon"><Icon size={23}/></span>
            <div><strong>{label}</strong>
              <small>{done?'Registro realizado':enabled?'Clique para registrar':'Aguardando etapa anterior'}</small></div>
            {done?<CheckCircle2 size={18}/>:enabled?<ArrowRight size={18}/>:<LockKeyhole size={17}/>}
          </button>;
        })}
      </div>
      {today?.blocked&&<p role="status" className="cpf-punch-warning">{today.blocked.message}
        {today.blocked.code==='company_punch_disabled'&&' Peça ao administrador para ativar “Permitir registro de ponto” em Configurações.'}</p>}
      {loading&&<p role="status" className="cpf-punch-muted">Consultando sua jornada…</p>}
      {disabled&&<div role="status" className="cpf-punch-warning">
        <ShieldCheck size={17}/> Marcação ainda em homologação. Nenhuma batida real está habilitada.
      </div>}
      {error&&<p role="alert" className="cpf-punch-error">{error}</p>}
      {notice&&<p role="status" className="cpf-punch-success"><CheckCircle2 size={16}/>{notice}</p>}
      {today?.completed&&<div className="day-completed"><CheckCircle2 size={17}/>
        Jornada concluída. Os registros foram confirmados pelo servidor.</div>}
      {lastConfirmation&&<div className="cpf-punch-receipt">
        <strong>Último registro confirmado · {descriptions[lastConfirmation.type]}</strong>
        <span>{format(lastConfirmation.recorded_at,true)}</span>
        <small>Identificação técnica do registro (não equivale a comprovante oficial):</small>
        <code>{lastConfirmation.receipt_hash}</code>
      </div>}
      <div className="punch-footnote"><ShieldCheck size={15}/>
        Aguarde a confirmação. Não há registro offline ou retroativo.
      </div>
      <button className="cr-reload-link" type="button" onClick={()=>void load()}
        disabled={loading||busy}><RefreshCw size={14}/> Atualizar registro</button>
    </section>
    <aside className="day-sidebar">
      <section className="panel day-summary">
        <div className="panel-header"><h3>Resumo do dia</h3><CalendarDays size={18}/></div>
        <div className="day-total"><span>Tempo trabalhado{livePunch?' · em andamento':''}</span>
          <strong>{today?totalMinutes(worked):'--:--'}<small>h</small></strong></div>
        <div className="summary-line"><span>Jornada prevista</span>
          <strong>{today?.expected_minutes!=null?totalMinutes(today.expected_minutes)+' h':'—'}</strong></div>
        <div className="summary-line"><span>Intervalo realizado</span>
          <strong>{today?.break_minutes!=null?totalMinutes(today.break_minutes)+' h':'—'}</strong></div>
        <div className="summary-line"><span>Último registro</span>
          <strong>{entries.length?format(entries[entries.length-1].recorded_at):'Nenhum'}</strong></div>
        <div className="employee-schedule"><span>SEU HORÁRIO CONTRATUAL</span>
          {today?.schedule?<><strong>{today.schedule.start} <ArrowRight size={14}/> {today.schedule.end}</strong>
            <small>Intervalo: {today.schedule.break_start} às {today.schedule.break_end}</small></>:
            <p>Jornada não disponível. Confira com o RH.</p>}
        </div>
      </section>
      <section className="panel timeline-panel">
        <div className="panel-header"><h3>Registros de hoje</h3>
          <span className="count-chip">{entries.length}/4</span></div>
        {!entries.length?<div className="timeline-empty"><Clock3 size={25}/>
          <span>Sua jornada começa com o primeiro registro.</span></div>:
        <ol className="timeline">{entries.map(p=><li key={p.id}>
          <span className="timeline-dot"/><div><strong>{marks[p.seq]?.[1]||p.type}</strong>
            <small>Confirmado no servidor</small></div><time>{format(p.recorded_at)}</time>
        </li>)}</ol>}
      </section>
    </aside>
  </div>;
}
