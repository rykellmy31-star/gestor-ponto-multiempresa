import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CalendarClock, CheckCircle2, Clock3, Copy, LogOut,
  Plus, RefreshCw, ShieldCheck, UsersRound
} from 'lucide-react';
import type { Schedule, ScheduleDay } from '../../server/types';
import './company-schedules-page.css';

type CompanySession = {
  user: { id:string; name:string; login:string };
  company: { id:string; slug:string };
  csrf_token:string;
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
const saturdayDefault:ScheduleDay={
  start:'07:00',break_start:'10:00',break_end:'10:15',
  end:'13:00',paid_break:true
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
async function jsonRequest<T>(path:string,options?:RequestInit):Promise<T> {
  let response:Response;
  try {
    response=await fetch('/api'+path,{
      credentials:'same-origin',cache:'no-store',...options
    });
  } catch {
    throw new Error('Sem conexão com o servidor da empresa. Nenhuma alteração foi gravada.');
  }
  const data=await response.json().catch(()=>null) as
    ({error?:{message?:string}}&T)|null;
  if(!response.ok) {
    if(response.status===503)throw new Error(
      'As escalas da empresa ainda estão em homologação. Nenhum cadastro foi alterado.'
    );
    throw new Error(data?.error?.message||
      (response.status===401?'Sessão encerrada. Entre novamente.':
      'Não foi possível confirmar. Nenhuma operação deve ser considerada concluída.'));
  }
  if(!data)throw new Error('O servidor retornou uma resposta inesperada.');
  return data;
}

export function CompanySchedulesPage() {
  const location=useLocation();
  const [session,setSession]=useState<CompanySession|null>(null);
  const [checking,setChecking]=useState(true);
  const [loginBusy,setLoginBusy]=useState(false);
  const [slug,setSlug]=useState('');
  const [login,setLogin]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [schedules,setSchedules]=useState<CompanySchedule[]>([]);
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [loading,setLoading]=useState(false);
  const [formOpen,setFormOpen]=useState(false);
  const [form,setForm]=useState<FormSchedule>(base);
  const [saving,setSaving]=useState(false);
  const [selectedSchedule,setSelectedSchedule]=useState('');
  const [selectedEmployee,setSelectedEmployee]=useState('');
  const [effective,setEffective]=useState('');
  const [assigning,setAssigning]=useState(false);

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
    if(!session)return;
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
      setError(err instanceof Error?err.message:'Erro ao consultar a empresa.');
    }finally{setLoading(false);}
  },[session]);
  useEffect(()=>{void load();},[load]);

  async function signIn(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);setError('');
    try{
      await jsonRequest<{success:boolean}>('/company/auth/login',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({company:slug.trim().toLowerCase(),login:login.trim(),password})
      });
      setPassword('');
      setChecking(true);
      await check();
      setNotice('Acesso empresarial confirmado.');
    }catch(err){
      setError(err instanceof Error?err.message:'Não foi possível entrar.');
      setPassword('');
    }finally{setLoginBusy(false);setChecking(false);}
  }
  async function signOut(){
    if(!session)return;
    try {
      await jsonRequest('/company/auth/logout',{
        method:'POST',headers:{'X-CSRF-Token':session.csrf_token}
      });
      setSession(null);setSchedules([]);setEmployees([]);
      setNotice('Você saiu da área empresarial.');
    } catch(err) {setError(err instanceof Error?err.message:'Não foi possível sair.');}
  }
  function update(key:keyof FormSchedule,value:unknown) {
    setForm(prev=>({...prev,[key]:value}));setError('');
  }
  function updateWeekday(day:number,checked:boolean){
    setForm(prev=>{
      const weekdays=checked?[...new Set([...prev.weekdays,day])].sort():
        prev.weekdays.filter(d=>d!==day);
      const day_overrides={...(prev.day_overrides||{})};
      if(!checked)delete day_overrides[String(day) as keyof typeof day_overrides];
      if(day===6&&checked&&!day_overrides['6'])day_overrides['6']={...saturdayDefault};
      return {...prev,weekdays,
        day_overrides:Object.keys(day_overrides).length?day_overrides:undefined};
    });
  }
  function weekdaysGroup(){
    setForm(prev=>({
      ...prev,weekdays:[...new Set([...prev.weekdays,1,2,3,4,5])].sort()
    }));
  }
  function updateSaturday(key:keyof ScheduleDay,value:string|boolean){
    setForm(prev=>({...prev,day_overrides:{
      ...(prev.day_overrides||{}),
      '6':{
        ...(prev.day_overrides?.['6']||{
          start:prev.start,break_start:prev.break_start,
          break_end:prev.break_end,end:prev.end,paid_break:prev.paid_break
        }),
        [key]:value
      }
    }}));
  }
  function startNew() {
    setForm({...base,weekdays:[...base.weekdays]});
    setFormOpen(true);setError('');setNotice('');
  }
  function duplicate(schedule:CompanySchedule) {
    setForm({...schedule.config,name:schedule.name+' — nova versão',
      weekdays:[...schedule.config.weekdays],
      day_overrides:schedule.config.day_overrides
        ?JSON.parse(JSON.stringify(schedule.config.day_overrides)):undefined});
    setFormOpen(true);setError('');setNotice('');
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!session||saving)return;
    setSaving(true);setError('');
    try {
      const {name,...config}=form;
      const response=await jsonRequest<{success:boolean;id:string;company_id:string}>(
        '/company/schedules',{
          method:'POST',
          headers:{'Content-Type':'application/json',
            'X-CSRF-Token':session.csrf_token},
          body:JSON.stringify({name,...config})
        });
      if(response.company_id!==session.company.id)
        throw new Error('A empresa retornada não corresponde à sessão.');
      setFormOpen(false);setNotice('Escala criada. Selecione um funcionário e atribua a nova escala.');
      setSelectedSchedule(response.id);
      await load();
    }catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.');}
    finally{setSaving(false);}
  }
  async function assign(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!session||assigning||!selectedSchedule||!selectedEmployee||!effective)return;
    if(!window.confirm('Confirmar esta escala para o funcionário selecionado a partir de '+effective.split('-').reverse().join('/')+'?'))return;
    setAssigning(true);setError('');
    try {
      const response=await jsonRequest<{success:boolean;company_id:string}>(
        '/company/schedules/'+encodeURIComponent(selectedSchedule)+'/assign',{
          method:'POST',headers:{'Content-Type':'application/json',
            'X-CSRF-Token':session.csrf_token},
          body:JSON.stringify({employee_id:selectedEmployee,effective_from:effective})
        });
      if(response.company_id!==session.company.id)
        throw new Error('A empresa retornada não corresponde à sessão.');
      setNotice('Escala atribuída com sucesso. Datas e jornadas anteriores serão preservadas conforme o histórico do sistema.');
      setSelectedEmployee('');
    }catch(err){setError(err instanceof Error?err.message:'Falha ao atribuir.');}
    finally{setAssigning(false);}
  }

  if(checking)return <main className="company-schedules-page">
    <div className="company-schedules-card">Conferindo acesso empresarial…</div>
  </main>;

  if(!session)return <main className="company-schedules-page">
    <div className="company-schedules-login">
      <div className="company-schedules-brand"><Clock3 size={27}/> CR JORNADA</div>
      <h1>Área administrativa da empresa</h1>
      <p>Entre com os dados da sua empresa para configurar funcionários e jornadas.</p>
      <form onSubmit={signIn}>
        <label>Identificador da empresa
          <input required value={slug} maxLength={60}
            autoComplete="organization"
            placeholder="exemplo: minha-empresa"
            onChange={e=>setSlug(e.target.value)}/>
        </label>
        <label>Usuário administrador
          <input required value={login} maxLength={200}
            autoComplete="username"
            onChange={e=>setLogin(e.target.value)}/>
        </label>
        <label>Senha
          <input required type="password" value={password}
            autoComplete="current-password"
            onChange={e=>setPassword(e.target.value)}/>
        </label>
        {error&&<p role="alert" className="company-schedules-error">{error}</p>}
        {notice&&<p role="status" className="company-schedules-notice">{notice}</p>}
        <button disabled={loginBusy}>{loginBusy?'Conferindo…':'Entrar na empresa'}</button>
      </form>
      <p className="company-schedules-hint">
        O acesso real exige o backend do CR JORNADA em homologação.
        Não informe senhas verdadeiras na prévia estática da Cloudflare Pages.
      </p>
      <Link to="/superadmin">Acesso Superadmin</Link>
    </div>
  </main>;

  const saturday=form.day_overrides?.['6']||{
    start:form.start,break_start:form.break_start,
    break_end:form.break_end,end:form.end,paid_break:form.paid_break
  };
  const total=weekly(form);
  return <main className="company-schedules-page">
    <div className="company-schedules-shell">
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

      <section className="company-schedules-card company-schedules-intro">
        <CalendarClock size={25}/>
        <div>
          <h2>Horários por dia da semana</h2>
          <p>Configure um horário para segunda a sexta e outro para o sábado, sem criar cadastros diferentes para o mesmo funcionário. Escalas antigas continuam preservadas.</p>
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
            const sat=item.config.day_overrides?.['6'];
            return <article key={item.id} className="company-schedules-item">
              <h3>{item.name}</h3>
              <p>Horário padrão: {item.config.start}–{item.config.end}</p>
              {sat&&item.config.weekdays.includes(6)&&
                <p>Sábado: {sat.start}–{sat.end} · Pausa {sat.break_start}–{sat.break_end}</p>}
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
            <p>Uma única escala para todos os dias selecionados.</p></div>
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
              onClick={weekdaysGroup}>Selecionar segunda a sexta juntos</button>
            <button type="button" className="company-schedules-secondary"
              onClick={()=>updateWeekday(6,!form.weekdays.includes(6))}>
              {form.weekdays.includes(6)?'Retirar sábado':'Adicionar sábado separado'}
            </button>
          </div>
          <fieldset className="company-schedules-weekdays">
            <legend>Dias com expediente</legend>
            <div>{weekdays.map((name,day)=><label key={day}>
              <input type="checkbox" checked={form.weekdays.includes(day)}
                onChange={e=>updateWeekday(day,e.target.checked)}/>{name}
            </label>)}</div>
          </fieldset>
          {form.weekdays.includes(6)&&<div className="company-schedules-saturday">
            <h3>Sábado — horários independentes</h3>
            <div className="company-schedules-fields">
              {fields.map(([key,label])=><label key={key}>{label}
                <input type="time" required value={saturday[key]}
                  onChange={e=>updateSaturday(key,e.target.value)}/>
              </label>)}
            </div>
            <label className="company-schedules-check">
              <input type="checkbox" checked={saturday.paid_break}
                onChange={e=>updateSaturday('paid_break',e.target.checked)}/>
              Intervalo do sábado remunerado
            </label>
          </div>}
          <div className="company-schedules-total">
            <span>Horário principal: {hours(count(form))}</span>
            {form.weekdays.includes(6)&&<span>Sábado: {hours(count(saturday))}</span>}
            <strong>Total da semana: {hours(total)}</strong>
          </div>
          {total>2640&&<p className="company-schedules-alert" role="status">
            Esta escala ultrapassa 44h semanais. Confira o contrato, as regras
            aplicáveis e as horas excedentes antes de atribuí-la.
          </p>}
          <p className="company-schedules-hint">
            Ao mudar uma escala já atribuída, crie uma nova versão e atribua-a com
            a data de início desejada. O cadastro anterior permanece para histórico.
          </p>
          <button type="submit" disabled={saving||!form.weekdays.length}>
            {saving?'Salvando…':'Salvar nova escala'}
          </button>
        </form>
      </section>}

      <section id="company-schedules-assignment" className="company-schedules-card">
        <div className="company-schedules-intro">
          <UsersRound size={23}/><div><h2>Atribuir escala ao funcionário</h2>
          <p>Somente escalas e funcionários da empresa autenticada aparecem nesta área.</p></div>
        </div>
        <form onSubmit={assign} className="company-schedules-assign">
          <label>Escala
            <select required value={selectedSchedule}
              onChange={e=>setSelectedSchedule(e.target.value)}>
              <option value="">Selecione uma escala</option>
              {schedules.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Funcionário
            <select required value={selectedEmployee}
              onChange={e=>setSelectedEmployee(e.target.value)}>
              <option value="">Selecione um funcionário</option>
              {employees.filter(e=>e.status==='active').map(e=>
                <option value={e.id} key={e.id}>{e.full_name} · {e.registration}</option>)}
            </select>
          </label>
          <label>Data de início da escala
            <input type="date" required value={effective}
              onChange={e=>setEffective(e.target.value)}/>
          </label>
          <button disabled={assigning||!selectedSchedule||!selectedEmployee||!effective}>
            {assigning?'Atribuindo…':'Confirmar atribuição'}
          </button>
        </form>
      </section>
      <p className="company-schedules-footer">CR JORNADA · Módulo em homologação. Nenhum ponto real é ativado nesta página.</p>
      {location.pathname==='/empresa/entrar'&&<p className="company-schedules-footer">
        <Link to="/empresa/jornadas">Ir para jornadas</Link></p>}
    </div>
  </main>;
}
