import {WorkspaceMood,WorkspaceRequests} from './company-workspace';
import {useEffect,useState,type FormEvent,type CSSProperties} from 'react';
import {BookOpen,Building2,ChevronRight,Clock3,FileSpreadsheet,
  HelpCircle,LogOut,Menu,MessageSquareText,ShieldCheck,
  UserRound,X,KeyRound} from 'lucide-react';
import {EmployeeCpfPunch} from './employee-cpf-punch';
import {EmployeeCpfPointHistory} from './employee-cpf-history';
import {CompanyOriginalBrand} from './company-original-brand';
import {Button,PageHeader} from './ui';

type EmployeeSession={
  user:{id:string;employee_id:string;name:string;role:'employee';must_change_password:boolean};
  company:{id:string;name:string;slug:string;timezone?:'America/Bahia'|'America/Sao_Paulo';
    logo_url?:string|null;primary_color?:string};
  csrf_token:string;expires_at:number;
};
type History={company_id:string;employee_id:string;month:string;
  days:Array<{date:string;punches:Array<{seq:number;recorded_at:number}>}>};
const clockMinutes=(n:number)=>Math.floor(n/60).toString().padStart(2,'0')+':'+
  Math.floor(n%60).toString().padStart(2,'0');

function EmployeeWeek({companyId,employeeId,timezone}:{
  companyId:string;employeeId:string;timezone:string
}){
  const [days,setDays]=useState<Array<{date:string;minutes:number}>>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const ctrl=new AbortController();
    const today=new Date();
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,
      year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(today);
    const value=(key:string)=>parts.find(p=>p.type===key)?.value||'';
    const local=value('year')+'-'+value('month')+'-'+value('day');
    const [year,month,day]=local.split('-').map(Number);
    const current=new Date(Date.UTC(year,month-1,day));
    const weekday=(current.getUTCDay()+6)%7;
    const monday=new Date(current.getTime()-weekday*86400000);
    const weeks=Array.from({length:7},(_,i)=>
      new Date(monday.getTime()+i*86400000).toISOString().slice(0,10));
    const months=[...new Set(weeks.map(d=>d.slice(0,7)))];
    setLoading(true);setError('');
    Promise.all(months.map(async m=>{
      const response=await fetch('/api/employee/cpf-work/history?month='+encodeURIComponent(m),{
        credentials:'same-origin',cache:'no-store',signal:ctrl.signal});
      if(!response.ok)throw new Error('Não foi possível consultar os registros da semana.');
      const data=await response.json() as History;
      if(data.company_id!==companyId||data.employee_id!==employeeId||data.month!==m)
        throw new Error('O histórico não corresponde à empresa da sessão.');
      return data;
    })).then(all=>{
      if(ctrl.signal.aborted)return;
      const list=all.flatMap(item=>item.days);
      setDays(weeks.map(date=>{
        const records=list.find(item=>item.date===date)?.punches||[];
        const time=(seq:number)=>records.find(p=>p.seq===seq)?.recorded_at;
        const first=time(0)!=null&&time(1)!=null?Math.max(0,time(1)!-time(0)!):0;
        const second=time(2)!=null&&time(3)!=null?Math.max(0,time(3)!-time(2)!):0;
        return {date,minutes:Math.floor((first+second)/60000)};
      }));
    }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[companyId,employeeId,timezone]);
  const max=Math.max(60,...days.map(d=>d.minutes));
  return <section className="panel week-preview cr-original-week">
    <div className="panel-header"><div><h3>Sua semana</h3>
      <p>Tempo confirmado entre as marcações · segunda a domingo</p></div><Clock3 size={19}/></div>
    {loading?<div className="cr-original-week-loading">Consultando registros da semana…</div>:
      error?<p role="alert" className="cr-original-week-loading">{error}</p>:
      <><div className="week-bars">
        {days.map((d,i)=><div className="week-bar" key={d.date}>
          <span>{clockMinutes(d.minutes)}</span><div><i style={{height:
            Math.max(d.minutes?3:0,d.minutes/max*100)+'%'}}/></div>
          <small>{['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'][i]}</small>
        </div>)}
      </div><div className="week-total"><span>Realizado na semana
        <strong>{clockMinutes(days.reduce((n,d)=>n+d.minutes,0))} h</strong></span>
      </div></>}
  </section>;
}

export function EmployeeOriginalWorkspace({session,historyVersion,onSessionExpired,
  onLogout,onPasswordChanged,onPunchConfirmed}:{
  session:EmployeeSession;historyVersion:number;
  onSessionExpired:()=>void;onLogout:()=>Promise<void>;
  onPasswordChanged:()=>void;onPunchConfirmed:()=>void;
}){
  const [view,setView]=useState<'clock'|'history'|'requests'|'account'|'help'>('clock');
  const [menu,setMenu]=useState(false);
  const [current,setCurrent]=useState(''),[password,setPassword]=useState('');
  const [confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const timezone=session.company.timezone||'America/Sao_Paulo';
  const firstName=session.user.name.split(' ')[0];
  const titles={clock:'Registrar ponto',history:'Minha folha de ponto',
    requests:'Minhas solicitações',account:'Minha conta',help:'Ajuda'};
  const navigation=[
    {id:'clock' as const,title:titles.clock,icon:Clock3},
    {id:'history' as const,title:titles.history,icon:FileSpreadsheet},
    {id:'requests' as const,title:titles.requests,icon:MessageSquareText},
    {id:'account' as const,title:titles.account,icon:UserRound}
  ];
  async function changePassword(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    if(password!==confirm){setError('A confirmação não corresponde à nova senha.');return;}
    if(password.length<12){setError('Use pelo menos 12 caracteres.');return;}
    setBusy(true);
    try{
      const response=await fetch('/api/employee/cpf-auth/password',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf_token},
        body:JSON.stringify({current_password:current,new_password:password})
      });
      const payload=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
      if(!response.ok)throw new Error(payload?.error?.message||'Senha não alterada. Confira os dados.');
      setCurrent('');setPassword('');setConfirm('');
      onPasswordChanged();
    }catch(err){setError(err instanceof Error?err.message:'Não foi possível alterar a senha.');}
    finally{setBusy(false);}
  }
  const switchView=(id:typeof view)=>{setView(id);setMenu(false);setError('');window.scrollTo(0,0);};
  const dateText=new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,
    day:'2-digit',month:'long',year:'numeric'}).format(new Date());
  return <div className="app-shell cr-classic-shell cr-employee-original-portal"
    style={{'--green':session.company.primary_color||'#087f6f'} as CSSProperties}>
    {menu&&<button className="nav-scrim" aria-label="Fechar menu" onClick={()=>setMenu(false)}/>}
    <aside className={'sidebar '+(menu?'sidebar-open':'')}>
      <div className="sidebar-brand">
        <CompanyOriginalBrand company={session.company}/>
        <button className="icon-btn mobile-only" aria-label="Fechar menu" onClick={()=>setMenu(false)}>
          <X size={19}/></button>
      </div>
      <div className="portal-label">PORTAL DO FUNCIONÁRIO</div>
      <nav aria-label="Menu principal">
        {navigation.map(({id,title,icon:Icon})=><button type="button" key={id}
          className={'nav-link '+(view===id?'active':'')} aria-current={view===id?'page':undefined}
          onClick={()=>switchView(id)}><Icon size={19}/><span>{title}</span></button>)}
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className="help-card cr-original-help" onClick={()=>switchView('help')}>
          <span><BookOpen size={19}/> Uma jornada mais simples</span>
          <small>Consulte o guia de uso do sistema.</small>
          <span>Abrir guia <ChevronRight size={14}/></span>
        </button>
        <button type="button" className="sidebar-user" onClick={()=>switchView('account')}>
          <span className="avatar">{firstName.slice(0,2).toUpperCase()}</span>
          <div><strong>{session.user.name}</strong><span>Funcionário</span></div>
          <ChevronRight size={16}/>
        </button>
        <button className="logout-btn" type="button" onClick={()=>void onLogout()}>
          <LogOut size={17}/> Sair da conta</button>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn mobile-only" type="button" aria-label="Abrir menu"
            onClick={()=>setMenu(true)}><Menu size={22}/></button>
          <div className="breadcrumb"><Building2 size={16}/>
            <span>{session.company.name}</span><ChevronRight size={13}/>
            <strong>{titles[view]}</strong></div>
        </div>
        <div className="topbar-right"><span className="topbar-date">{dateText}</span>
          <button className="icon-btn" type="button" aria-label="Ajuda"
            onClick={()=>switchView('help')}><HelpCircle size={19}/></button></div>
      </header>
      <main className="page-content">
        {view==='clock'&&<>
          <PageHeader eyebrow="SEU TEMPO, SUA JORNADA" title={'Olá, '+firstName+'. Bom trabalho!'}
            description="Registre seu ponto e acompanhe seu dia em um só lugar."/>
          <EmployeeCpfPunch key={session.user.id+session.company.id}
            companyId={session.company.id} employeeId={session.user.employee_id}
            csrfToken={session.csrf_token} timezone={session.company.timezone}
            onConfirmed={onPunchConfirmed}
            onSessionExpired={onSessionExpired}/>
          <WorkspaceMood companyId={session.company.id} employeeId={session.user.employee_id} csrf={session.csrf_token} onSessionExpired={onSessionExpired}/>
          <EmployeeWeek key={historyVersion} companyId={session.company.id}
            employeeId={session.user.employee_id} timezone={timezone}/>
        </>}
        {view==='history'&&<>
          <PageHeader eyebrow="ACOMPANHAMENTO INDIVIDUAL" title="Minha folha de ponto"
            description="Consulte seus registros confirmados e baixe o extrato CSV."/>
          <EmployeeCpfPointHistory companyId={session.company.id}
            employeeId={session.user.employee_id} timezone={session.company.timezone}
            refreshVersion={historyVersion} onSessionExpired={onSessionExpired}/>
        </>}
        {view==='requests'&&<>
          <PageHeader eyebrow="DIÁLOGO COM O RH" title="Minhas solicitações"
            description="Acompanhe solicitações e justificativas para o administrador."/>
          <WorkspaceRequests companyId={session.company.id} employeeId={session.user.employee_id} csrf={session.csrf_token} onSessionExpired={onSessionExpired}/>
        </>}
        {view==='account'&&<>
          <PageHeader eyebrow="SEGURANÇA E PRIVACIDADE" title="Minha conta"
            description="Atualize sua senha pessoal e proteja o acesso à sua jornada."/>
          <section className="panel cr-original-account"><KeyRound size={22}/>
            <h3>Alterar minha senha</h3>
            <p>Após alterar a senha, todas as sessões serão encerradas.</p>
            <form onSubmit={event=>void changePassword(event)}>
              <label>Senha atual<input type="password" required autoComplete="current-password"
                value={current} onChange={e=>setCurrent(e.target.value)} maxLength={128}/></label>
              <label>Nova senha<input type="password" required autoComplete="new-password"
                minLength={12} value={password} onChange={e=>setPassword(e.target.value)} maxLength={128}/></label>
              <label>Confirme a nova senha<input type="password" required autoComplete="new-password"
                minLength={12} value={confirm} onChange={e=>setConfirm(e.target.value)} maxLength={128}/></label>
              {error&&<p role="alert" className="cpf-punch-error">{error}</p>}
              <Button disabled={busy}>{busy?'Alterando…':'Alterar senha'}</Button>
            </form>
          </section>
        </>}
        {view==='help'&&<>
          <PageHeader eyebrow="CENTRAL DE AJUDA" title="Sua jornada, sem complicação."
            description="Orientações rápidas para registrar ponto com segurança."/>
          <section className="panel cr-original-pending"><ShieldCheck size={24}/>
            <h3>Como registrar seu ponto</h3>
            <p>Use o único botão ativo. A ordem é entrada, início do intervalo, retorno
              do intervalo e saída final. Cada marcação exige confirmação do servidor.
              Em caso de erro de rede, confira o último registro antes de tentar novamente.</p>
          </section>
        </>}
      </main>
      <footer className="app-footer"><span>CR JORNADA <span>Gestão de tempo com confiança.</span></span>
        <span><ShieldCheck size={13}/> Dados exclusivos da sua empresa</span></footer>
    </div>
  </div>;
}
