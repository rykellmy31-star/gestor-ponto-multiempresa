import { CompanyPunchPolicy } from './company-punch-policy';
import { CompanyCalculations } from './company-calculations';
import { CompanyClosures } from './company-closures';
import { CompanyDayEvents } from './company-day-events';
import { CompanyAttendance } from './company-attendance';
import { CompanyEmployeeAccess } from './company-employee-access';
import { jsonRequest,isExpiredCompanySession } from './company-schedules-network';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  CalendarClock, CheckCircle2, Copy, LogOut,
  Plus, RefreshCw, ShieldCheck, UsersRound
} from 'lucide-react';
import type { Schedule, ScheduleDay } from '../../server/types';
import { allWeekdays, applyStandardShiftToAll, resetShiftForDay, selectScheduleDays, shiftForDay, updateShiftForDay } from './company-schedule-editor';
import './company-schedules-page.css';

type CompanySession = {
  user: { id:string; name:string; login:string };
  company: { id:string; slug:string };
  csrf_token:string;
  must_change_password?: boolean;
};
type CompanySchedule = {
  id:string; name:string; config:Schedule; created_at:number;
};
type Employee = {
  id:string; full_name:string; registration:string; status:string;
};
type FormSchedule = Schedule & {name:string};

const weekdays=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const base:FormSchedule={
  name:'',start:'08:00',break_start:'12:00',
  break_end:'13:00',end:'17:00',
  weekdays:[1,2,3,4,5],paid_break:false
};
const fields=[
  ['start','Entrada'],['break_start','Início do intervalo'],
  ['break_end','Retorno do intervalo'],['end','Saída']
] as const;

function min(value:string) {
  const [h,m]=value.split(':').map(Number);
  return h*60+m;
}
function count(shift:ScheduleDay) {
  const start=min(shift.start);
  const after=(v:string)=>min(v)<start?min(v)+1440:min(v);
  const end=min(shift.end)<=start?min(shift.end)+1440:min(shift.end);
  const pause=after(shift.break_end)-after(shift.break_start);
  return end-start-(shift.paid_break?0:pause);
}
function weekly(config:Schedule) {
  return config.weekdays.reduce((sum,day)=>{
    const specific=config.day_overrides?.[String(day) as keyof NonNullable<Schedule['day_overrides']>];
    return sum+count(specific||config);
  },0);
}
function hours(n:number) {
  if(!Number.isFinite(n)||n<0)return '—';
  return Math.floor(n/60)+'h'+String(n%60).padStart(2,'0');
}
export function CompanySchedulesPage() {
  const navigate=useNavigate();
  const pendingScheduleCreate=useRef<{payload:string;key:string}|null>(null);
  const [session,setSession]=useState<CompanySession|null>(null);
  const [checking,setChecking]=useState(true);
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [changingPassword,setChangingPassword]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [schedules,setSchedules]=useState<CompanySchedule[]>([]);
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [loading,setLoading]=useState(false);
  const [formOpen,setFormOpen]=useState(false);
  const [form,setForm]=useState<FormSchedule>(base);
  const [editDayByDay,setEditDayByDay]=useState(false);
  const [saving,setSaving]=useState(false);
  const [selectedSchedule,setSelectedSchedule]=useState('');
  const [selectedEmployee,setSelectedEmployee]=useState('');
  const [assignAll,setAssignAll]=useState(false);
  const [effective,setEffective]=useState('');
  const [assigning,setAssigning]=useState(false);
  const [previewing,setPreviewing]=useState(false);
  const [weekPreview,setWeekPreview]=useState<Array<{
    date:string;assignment_id:string|null;shift:Schedule|null;
  }> | null>(null);

  const clearCompanyDraft=useCallback(()=>{
    pendingScheduleCreate.current=null;
    setSchedules([]);
    setEmployees([]);
    setSelectedSchedule('');
    setSelectedEmployee('');
    setAssignAll(false);
    setEffective('');
    setWeekPreview(null);
    setForm({...base,weekdays:[...base.weekdays]});
    setFormOpen(false);
    setEditDayByDay(false);
    setNotice('');
  },[]);
  const onSessionExpired=useCallback(()=>{
    clearCompanyDraft();
    setSession(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('Sua sessão empresarial expirou. Entre novamente.');
  },[clearCompanyDraft]);
  const handleRequestError=useCallback((err:unknown,fallback:string)=>{
    if(isExpiredCompanySession(err)){
      onSessionExpired();
      return;
    }
    setError(err instanceof Error?err.message:fallback);
  },[onSessionExpired]);

  const check=useCallback(async()=>{
    try{
      const data=await jsonRequest<CompanySession>('/company/auth/session');
      setSession(data);
    }catch{
      // Pages publica somente arquivos estaticos: aqui nao existe sessao real.
      setSession(null);
    }finally{setChecking(false);}
  },[]);
  useEffect(()=>{void check();},[check]);

  const load=useCallback(async()=>{
    if(!session||session.must_change_password)return;
    setLoading(true);setError('');
    try {
      const [a,b]=await Promise.all([
        jsonRequest<{company_id:string;schedules:CompanySchedule[]}>('/company/schedules'),
        jsonRequest<{company_id:string;employees:Employee[]}>('/company/employees')
      ]);
      if(a.company_id!==session.company.id||b.company_id!==session.company.id)
        throw new Error('Os dados da sessão empresarial mudaram. Entre novamente.');
      setSchedules(a.schedules);
      setEmployees(b.employees);
    }catch(err){
      setSchedules([]);setEmployees([]);
      handleRequestError(err,'Erro ao consultar a empresa.');
    }finally{setLoading(false);}
  },[session,handleRequestError]);
  useEffect(()=>{void load();},[load]);

  async function changeInitialPassword(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!session||changingPassword)return;
    if(newPassword!==confirmPassword){
      setError('A confirmação não corresponde à nova senha.');
      return;
    }
    if(newPassword===currentPassword){
      setError('A nova senha precisa ser diferente da senha inicial.');
      return;
    }
    setChangingPassword(true);setError('');setNotice('');
    try{
      const result=await jsonRequest<{success:boolean;requires_login:boolean}>(
        '/company/auth/change-password',{
          method:'POST',headers:{
            'Content-Type':'application/json',
            'X-CSRF-Token':session.csrf_token
          },
          body:JSON.stringify({
            current_password:currentPassword,
            new_password:newPassword
          })
        });
      if(!result.success||!result.requires_login){
        throw new Error('A troca de senha não foi confirmada.');
      }
      setSession(null);
      clearCompanyDraft();
      navigate('/admin/entrar',{replace:true,state:{notice:'Senha alterada. Entre novamente com a nova senha.'}});
    }catch(err){
      handleRequestError(err,'Falha na troca de senha.');
    }finally{
      setCurrentPassword('');setNewPassword('');setConfirmPassword('');
      setChangingPassword(false);
    }
  }
  async function signOut(){
    if(!session)return;
    try {
      await jsonRequest('/company/auth/logout',{
        method:'POST',headers:{'X-CSRF-Token':session.csrf_token}
      });
      setSession(null);
      clearCompanyDraft();
      navigate('/admin/entrar',{replace:true,state:{notice:'Você saiu da área empresarial.'}});
    } catch(err) {handleRequestError(err,'Não foi possível sair.');}
  }
  function update(key:keyof FormSchedule,value:unknown) {
    setForm(prev=>({...prev,[key]:value}));setError('');
  }
  function updateWeekday(day:number,checked:boolean){
    setForm(prev=>selectScheduleDays(prev,checked
      ? [...prev.weekdays,day] : prev.weekdays.filter(d=>d!==day)));
  }
  function setAllDays(days:number[]){
    setForm(prev=>selectScheduleDays(prev,days));
  }
  function updateDailyShift(day:number,key:keyof ScheduleDay,value:string|boolean){
    setForm(prev=>({...prev,...updateShiftForDay(prev,day,key,value)}));
  }
  function resetDailyShift(day:number){
    setForm(prev=>resetShiftForDay(prev,day));
  }
  function startNew() {
    setForm({...base,weekdays:[...base.weekdays]});
    setEditDayByDay(false);
    setFormOpen(true);setError('');setNotice('');
  }
  function duplicate(schedule:CompanySchedule) {
    setForm({...schedule.config,name:schedule.name+' — nova versão',
      weekdays:[...schedule.config.weekdays],
      day_overrides:schedule.config.day_overrides
        ?JSON.parse(JSON.stringify(schedule.config.day_overrides)):undefined});
    setEditDayByDay(Boolean(schedule.config.day_overrides && Object.keys(schedule.config.day_overrides).length));
    setFormOpen(true);setError('');setNotice('');
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!session||saving)return;
    setSaving(true);setError('');
    try {
      const {name,...config}=form;
      const payload=JSON.stringify({name,...config});
      // Se a resposta se perdeu, repetir a mesma chave nao cria outra escala.
      // Editar a escala altera o payload e recebe nova chave.
      if(!pendingScheduleCreate.current || pendingScheduleCreate.current.payload!==payload)
        pendingScheduleCreate.current={payload,key:crypto.randomUUID()};
      const response=await jsonRequest<{success:boolean;id:string;company_id:string;reused?:boolean}>(
        '/company/schedules',{
          method:'POST',
          headers:{'Content-Type':'application/json',
            'X-CSRF-Token':session.csrf_token,
            'Idempotency-Key':pendingScheduleCreate.current.key},
          body:payload
        });
      if(response.company_id!==session.company.id)
        throw new Error('A empresa retornada não corresponde à sessão.');
      pendingScheduleCreate.current=null;
      setFormOpen(false);setNotice(response.reused
        ?'Escala já cadastrada, recuperada sem duplicar. Selecione um funcionário.'
        :'Escala criada. Selecione um funcionário e atribua a nova escala.');
      setSelectedSchedule(response.id);
      await load();
    }catch(err){handleRequestError(err,'Falha ao salvar.');}
    finally{setSaving(false);}
  }
  async function previewWeek(){
    if(!session||!selectedEmployee||!effective||previewing)return;
    setPreviewing(true);setError('');
    try{
      const response=await jsonRequest<{
        success:boolean;company_id:string;employee_id:string;
        days:Array<{date:string;assignment_id:string|null;shift:Schedule|null}>;
      }>('/company/schedules/employee/'+encodeURIComponent(selectedEmployee)+
        '/week?from='+encodeURIComponent(effective));
      if(response.company_id!==session.company.id||
        response.employee_id!==selectedEmployee)
        throw new Error('A prévia retornou dados de outra empresa ou funcionário.');
      setWeekPreview(response.days);
    }catch(err){
      setWeekPreview(null);
      handleRequestError(err,'Erro ao consultar a escala.');
    }finally{setPreviewing(false);}
  }
  async function assign(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!session||assigning||!selectedSchedule||(!assignAll&&!selectedEmployee)||!effective)return;
    const text=assignAll?'TODOS os funcionários ativos da empresa':'o funcionário selecionado';
    if(!window.confirm('Confirmar esta escala para '+text+' a partir de '+
      effective.split('-').reverse().join('/')+
      '? A operação em lote não será parcial.'))return;
    setAssigning(true);setError('');
    try {
      if(assignAll){
        const response=await jsonRequest<{success:boolean;company_id:string;
          assigned_count:number;reused_count:number}>(
          '/company/schedules/'+encodeURIComponent(selectedSchedule)+'/assign-all',{
            method:'POST',headers:{'Content-Type':'application/json',
              'X-CSRF-Token':session.csrf_token},
            body:JSON.stringify({effective_from:effective})
          });
        if(response.company_id!==session.company.id)
          throw new Error('A empresa retornada não corresponde à sessão.');
        setNotice('Escala aplicada: '+response.assigned_count+' funcionário(s) atualizado(s), '+
          response.reused_count+' já possuíam esta jornada. Histórico preservado.');
      }else{
        const response=await jsonRequest<{success:boolean;company_id:string;reused?:boolean}>(
          '/company/schedules/'+encodeURIComponent(selectedSchedule)+'/assign',{
            method:'POST',headers:{'Content-Type':'application/json',
              'X-CSRF-Token':session.csrf_token},
            body:JSON.stringify({employee_id:selectedEmployee,effective_from:effective})
          });
        if(response.company_id!==session.company.id)
          throw new Error('A empresa retornada não corresponde à sessão.');
        setNotice(response.reused
          ? 'Atribuição já confirmada. Nenhum registro duplicado foi criado.'
          : 'Escala atribuída com sucesso. Datas e jornadas anteriores serão preservadas conforme o histórico do sistema.');
      }
      setWeekPreview(null);
    }catch(err){handleRequestError(err,'Falha ao atribuir.');}
    finally{setAssigning(false);}
  }

  if(checking)return <main className="company-schedules-page">
    <div className="company-schedules-card">Conferindo acesso empresarial…</div>
  </main>;

  if(!session)return <Navigate to="/admin/entrar" replace/>;

  if(session.must_change_password)return <main className="company-schedules-page">
    <section className="company-schedules-login">
      <div className="company-schedules-brand"><ShieldCheck size={27}/> CR JORNADA</div>
      <h1>Proteja sua conta</h1>
      <p>Antes de acessar os funcionários e as escalas da empresa
        <strong> {session.company.slug}</strong>, substitua a senha inicial
        recebida do Superadmin. Depois você precisará entrar novamente.</p>
      <form onSubmit={changeInitialPassword}>
        <label>Senha inicial
          <input type="password" value={currentPassword}
            required autoComplete="current-password" minLength={1}
            onChange={e=>setCurrentPassword(e.target.value)}/>
        </label>
        <label>Nova senha (mínimo 12 caracteres)
          <input type="password" value={newPassword} required
            minLength={12} maxLength={128} autoComplete="new-password"
            onChange={e=>setNewPassword(e.target.value)}/>
        </label>
        <label>Confirme a nova senha
          <input type="password" value={confirmPassword} required
            minLength={12} maxLength={128} autoComplete="new-password"
            onChange={e=>setConfirmPassword(e.target.value)}/>
        </label>
        {error&&<p role="alert" className="company-schedules-error">{error}</p>}
        <button type="submit" disabled={changingPassword}>
          {changingPassword?'Protegendo acesso…':'Alterar senha inicial'}
        </button>
      </form>
      <p className="company-schedules-hint">
        A nova senha não será exibida na tela nem enviada por e-mail.
        Não insira credenciais reais na prévia estática do Cloudflare Pages.
      </p>
      <button type="button" className="company-schedules-secondary"
        onClick={()=>void signOut()}>Sair da conta</button>
    </section>
  </main>;

  const total=weekly(form);
  return <main className="company-schedules-page">
    <div className="company-schedules-shell">
      <aside className="cr-legacy-sidebar" aria-label="Menu administrativo da empresa">
        <div className="cr-legacy-sidebar-brand"><CalendarClock size={25}/> CR JORNADA</div>
        <div className="cr-legacy-sidebar-title">PAINEL ADMINISTRATIVO</div>
        <nav className="cr-legacy-sidebar-nav">
          <a href="#cr-gestao-equipe"><UsersRound size={17}/> Funcionários</a>
          <a href="#cr-politica-ponto"><ShieldCheck size={17}/> Regras de ponto</a>
          <a href="#cr-apuracao"><CalendarClock size={17}/> Folhas e relatórios</a>
          <a href="#cr-registros"><CheckCircle2 size={17}/> Registros de ponto</a>
          <a href="#cr-jornadas"><CalendarClock size={17}/> Jornadas e escalas</a>
        </nav>
        <p className="cr-legacy-sidebar-note">Empresa: {session.company.slug}</p>
      </aside>
      <div className="cr-legacy-main">
      <header className="company-schedules-head">
        <div>
          <span className="company-schedules-overline"><ShieldCheck size={15}/> Área exclusiva da empresa</span>
          <h1>Jornadas e escalas</h1>
          <p>Empresa: <strong>{session.company.slug}</strong> · Administrador: {session.user.name}</p>
        </div>
        <button type="button" className="company-schedules-secondary" onClick={()=>void signOut()}>
          <LogOut size={16}/> Sair
        </button>
      </header>

      <div id="cr-gestao-equipe" className="cr-legacy-group">
      <CompanyEmployeeAccess key={session.company.id+':'+session.user.id+':'+session.csrf_token}
        companyId={session.company.id} csrf={session.csrf_token}
        onEmployeeCreated={()=>void load()}
        onSessionExpired={onSessionExpired}/>
      </div>

      <div id="cr-politica-ponto" className="cr-legacy-group">
      <CompanyPunchPolicy key={session.company.id+':'+session.user.id+':'+session.csrf_token}
        companyId={session.company.id} csrf={session.csrf_token} onSessionExpired={onSessionExpired}/>
      </div>

      <div id="cr-apuracao" className="cr-legacy-group">
      <CompanyCalculations key={session.company.id+':'+session.user.id+':'+session.csrf_token}
        companyId={session.company.id} employees={employees} onSessionExpired={onSessionExpired}/>
      <CompanyClosures key={session.company.id+':closures:'+session.csrf_token}
        companyId={session.company.id} employees={employees} csrf={session.csrf_token} onSessionExpired={onSessionExpired}/>
      <CompanyDayEvents key={session.company.id+':events:'+session.csrf_token}
        companyId={session.company.id} employees={employees} csrf={session.csrf_token} onSessionExpired={onSessionExpired}/>
      </div>

      <div id="cr-registros" className="cr-legacy-group">
      <CompanyAttendance key={session.company.id+':'+session.user.id+':'+session.csrf_token}
        companyId={session.company.id} employees={employees} onSessionExpired={onSessionExpired}/>
      </div>

      <div id="cr-jornadas" className="cr-legacy-group">
      <section className="company-schedules-card company-schedules-intro">
        <CalendarClock size={25}/>
        <div>
          <h2>Horários por dia da semana</h2>
          <p>Defina um horário para todos os dias ou configure cada dia separadamente. Crie modelos por equipe ou funcionário e atribua mudanças de turno por data, preservando o histórico.</p>
        </div>
      </section>

      {error&&<p role="alert" className="company-schedules-error">{error}</p>}
      {notice&&<p role="status" className="company-schedules-notice"><CheckCircle2 size={17}/>{notice}</p>}

      <div className="company-schedules-bar">
        <h2>Escalas cadastradas</h2>
        <div>
          <button type="button" className="company-schedules-secondary"
            onClick={()=>void load()} disabled={loading}>
            <RefreshCw size={16}/> Atualizar
          </button>
          <button type="button" onClick={startNew}><Plus size={16}/> Nova escala</button>
        </div>
      </div>
      {loading?<p>Consultando escalas…</p>:
        <div className="company-schedules-list">
          {schedules.length===0&&<p>Nenhuma escala disponível. Crie a primeira jornada da empresa.</p>}
          {schedules.map(item=>{
            const special=Object.entries(item.config.day_overrides||{})
              .filter(([d])=>item.config.weekdays.includes(Number(d)))
              .sort(([a],[b])=>Number(a)-Number(b));
            return <article key={item.id} className="company-schedules-item">
              <h3>{item.name}</h3>
              <p>Horário padrão: {item.config.start}–{item.config.end}</p>
              {special.map(([day,shift])=><p key={day}>
                {weekdays[Number(day)]}: {shift.start}–{shift.end} · Pausa {shift.break_start}–{shift.break_end}
              </p>)}
              <p>Dias: {item.config.weekdays.map(d=>weekdays[d]).join(', ')}</p>
              <strong>{hours(weekly(item.config))} semanais</strong>
              <div>
                <button type="button" className="company-schedules-secondary"
                  onClick={()=>duplicate(item)}><Copy size={15}/> Criar nova versão</button>
                <button type="button" onClick={()=>{
                  setSelectedSchedule(item.id);
                  document.getElementById('company-schedules-assignment')?.scrollIntoView({behavior:'smooth'});
                }}>Atribuir</button>
              </div>
            </article>;
          })}
        </div>}

      {formOpen&&<section className="company-schedules-card company-schedules-form-panel">
        <div className="company-schedules-bar">
          <div><h2>Configurar escala</h2>
            <p>Escolha horários iguais para todos ou personalize cada dia de expediente.</p></div>
          <button className="company-schedules-secondary" type="button"
            onClick={()=>{setFormOpen(false);setError('');}}>Fechar</button>
        </div>
        <form onSubmit={save}>
          <label>Nome da escala
            <input required minLength={3} maxLength={100} value={form.name}
              placeholder="Ex.: Comercial segunda a sábado"
              onChange={e=>update('name',e.target.value)}/>
          </label>
          <h3>Horário principal</h3>
          <div className="company-schedules-fields">
            {fields.map(([key,label])=><label key={key}>{label}
              <input type="time" required value={form[key]}
                onChange={e=>update(key,e.target.value)}/>
            </label>)}
          </div>
          <label className="company-schedules-check">
            <input type="checkbox" checked={form.paid_break}
              onChange={e=>update('paid_break',e.target.checked)}/>
            Intervalo principal remunerado
          </label>
          <div className="company-schedules-shortcuts">
            <button type="button" className="company-schedules-secondary"
              onClick={()=>setAllDays(allWeekdays)}>Selecionar todos os dias</button>
            <button type="button" className="company-schedules-secondary"
              onClick={()=>setAllDays([1,2,3,4,5])}>Selecionar segunda a sexta</button>
            <button type="button" className="company-schedules-secondary"
              onClick={()=>setAllDays([])}>Desmarcar todos</button>
          </div>
          <fieldset className="company-schedules-weekdays">
            <legend>Dias com expediente</legend>
            <div>{weekdays.map((name,day)=><label key={day}>
              <input type="checkbox" checked={form.weekdays.includes(day)}
                onChange={e=>updateWeekday(day,e.target.checked)}/>{name}
            </label>)}</div>
          </fieldset>
          <div className="company-schedules-shortcuts">
            <button type="button" className="company-schedules-secondary"
              aria-pressed={!editDayByDay}
              onClick={()=>{
                setForm(prev=>applyStandardShiftToAll(prev));
                setEditDayByDay(false);
                setError('');
              }}>Mesmo horário em todos</button>
            <button type="button" className="company-schedules-secondary"
              aria-pressed={editDayByDay}
              onClick={()=>setEditDayByDay(true)}>Editar dia por dia</button>
            <button type="button" className="company-schedules-secondary"
              onClick={()=>setForm(prev=>applyStandardShiftToAll(prev))}>
              Aplicar horário principal a todos
            </button>
          </div>
          {editDayByDay&&<div className="company-schedules-daily-list">
            {form.weekdays.map(day=>{
              const shift=shiftForDay(form,day);
              const custom=Boolean(form.day_overrides?.[
                String(day) as keyof NonNullable<Schedule['day_overrides']>
              ]);
              return <fieldset className="company-schedules-daily" key={day}>
                <legend>{weekdays[day]} · {custom?'Personalizado':'Horário principal'}</legend>
                <div className="company-schedules-fields">
                  {fields.map(([key,label])=><label key={key}>{label}
                    <input type="time" required value={shift[key]}
                      onChange={e=>updateDailyShift(day,key,e.target.value)}/>
                  </label>)}
                </div>
                <label className="company-schedules-check">
                  <input type="checkbox" checked={shift.paid_break}
                    onChange={e=>updateDailyShift(day,'paid_break',e.target.checked)}/>
                  Intervalo remunerado
                </label>
                <div className="company-schedules-daily-footer">
                  <span>Carga diária: {hours(count(shift))}</span>
                  <button type="button" className="company-schedules-secondary"
                    disabled={!custom} onClick={()=>resetDailyShift(day)}>
                    Usar horário principal
                  </button>
                </div>
              </fieldset>;
            })}
          </div>}
          <div className="company-schedules-total">
            <span>Horário principal: {hours(count(form))}</span>
            <span>Dias selecionados: {form.weekdays.length}</span>
            <strong>Total da semana: {hours(total)}</strong>
          </div>
          {total>2640&&<p className="company-schedules-alert" role="status">
            Esta escala ultrapassa 44h semanais. Confira o contrato, as regras
            aplicáveis e as horas excedentes antes de atribuí-la.
          </p>}
          <p className="company-schedules-hint">
            Para turnos diferentes por funcionário, crie modelos de escala e atribua o modelo
            adequado com a data de início. Ex.: João recebe turno das 07h hoje e turno das 13h amanhã.
            A mudança vale a partir da data atribuída; os registros anteriores permanecem no histórico.
          </p>
          <button type="submit" disabled={saving||!form.weekdays.length}>
            {saving?'Salvando…':'Salvar nova escala'}
          </button>
        </form>
      </section>}

      <section id="company-schedules-assignment" className="company-schedules-card">
        <div className="company-schedules-intro">
          <UsersRound size={23}/><div><h2>Atribuir escala ao funcionário</h2>
          <p>Atribua uma jornada a um funcionário ou a todos os ativos de uma vez.
          Para alterar o turno de João amanhã, atribua outra escala com a data de amanhã.</p></div>
        </div>
        <form onSubmit={assign} className="company-schedules-assign">
          <label>Escala
            <select required value={selectedSchedule}
              onChange={e=>setSelectedSchedule(e.target.value)}>
              <option value="">Selecione uma escala</option>
              {schedules.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="company-schedules-all-option">
            <input type="checkbox" checked={assignAll}
              onChange={e=>{setAssignAll(e.target.checked);setWeekPreview(null);}}/>
            Atribuir a todos os funcionários ativos
          </label>
          <label>Funcionário
            <select required={!assignAll} disabled={assignAll} value={selectedEmployee}
              onChange={e=>{setSelectedEmployee(e.target.value);setWeekPreview(null);}}>
              <option value="">Selecione um funcionário</option>
              {employees.filter(e=>e.status==='active').map(e=>
                <option value={e.id} key={e.id}>{e.full_name} · {e.registration}</option>)}
            </select>
          </label>
          <label>Data de início da escala
            <input type="date" required value={effective}
              onChange={e=>{setEffective(e.target.value);setWeekPreview(null);}}/>
          </label>
          <button disabled={assigning||!selectedSchedule||(!assignAll&&!selectedEmployee)||!effective}>
            {assigning?'Atribuindo…':assignAll?'Atribuir a todos os ativos':'Confirmar atribuição'}
          </button>
          <button type="button" className="company-schedules-secondary"
            disabled={previewing||assignAll||!selectedEmployee||!effective}
            onClick={()=>void previewWeek()}>
            {previewing?'Consultando…':'Pré-visualizar os próximos 7 dias'}
          </button>
        </form>
        {weekPreview&&<div className="company-schedules-week-preview"
          aria-label="Prévia da escala do funcionário">
          <h3>Turnos por data — funcionário selecionado</h3>
          <ul>{weekPreview.map(item=><li key={item.date}>
            <strong>{item.date.split('-').reverse().join('/')}</strong>
            <span>{item.shift
              ? item.shift.start+'–'+item.shift.end+
                ' · Intervalo '+item.shift.break_start+'–'+item.shift.break_end
              : item.assignment_id?'Folga (sem expediente)':'Sem escala atribuída'}</span>
          </li>)}</ul>
          <p className="company-schedules-hint">
            Prévia informativa. O ponto utiliza os registros reais e as regras
            vigentes no momento da marcação.
          </p>
        </div>}
      </section>
      <p className="company-schedules-footer">CR JORNADA · Módulo em homologação. Nenhum ponto real é ativado nesta página.</p>
      </div>
      </div>
    </div>
  </main>;
}
