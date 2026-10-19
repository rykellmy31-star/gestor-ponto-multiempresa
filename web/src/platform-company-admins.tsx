import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, RefreshCw, ShieldCheck, UserPlus, X } from 'lucide-react';
import './platform-company-admins.css';

type CompanyRef = {
  id: string;
  name: string;
  slug: string;
  status: 'active'|'suspended'|'archived';
};
type Manager = {
  id: string;
  company_id: string;
  login: string;
  email: string|null;
  display_name: string;
  active: number;
  created_at: number;
};
type Form = { name:string; login:string; email:string; password:string };
const blank:Form = { name:'',login:'',email:'',password:'' };

async function read<T>(res:Response):Promise<T> {
  const body=await res.json().catch(()=>null) as
    (T & {error?:{message?:string}})|null;
  if(!res.ok)throw new Error(body?.error?.message||
    (res.status===401?'Sessão expirada. Entre novamente.':
      'Não foi possível concluir a solicitação.'));
  if(!body)throw new Error('O servidor retornou uma resposta inválida.');
  return body;
}

export function PlatformCompanyAdmins({
  company, csrfToken, onClose
}:{
  company:CompanyRef;
  csrfToken:string;
  onClose:()=>void;
}) {
  const [managers,setManagers]=useState<Manager[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [changing,setChanging]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [form,setForm]=useState<Form>(blank);
  const [showPassword,setShowPassword]=useState(false);
  const endpoint='/api/platform/companies/'+encodeURIComponent(company.id)+'/admins';

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const res=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});
      const body=await read<{admins:Manager[]}>(res);
      if(body.admins.some(a=>a.company_id!==company.id))
        throw new Error('Dados de outra empresa detectados. Consulte a administração.');
      setManagers(body.admins);
    }catch(e){
      setManagers([]);
      setError(e instanceof Error?e.message:'Erro ao listar administradores.');
    }finally{setLoading(false);}
  },[endpoint,company.id]);
  useEffect(()=>{void load();},[load]);

  async function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy||company.status!=='active')return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch(endpoint,{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify({
          name:form.name.trim(),login:form.login.trim(),
          email:form.email.trim(),password:form.password
        })
      });
      const result=await read<{success:boolean}>(response);
      if(!result.success)throw new Error('O cadastro não foi confirmado.');
      setForm(blank);setShowPassword(false);
      setNotice('Administrador cadastrado. Informe os dados de acesso em um canal seguro. Nenhuma senha foi enviada por e-mail.');
      await load();
    }catch(err){
      setError(err instanceof Error?err.message:'Erro ao cadastrar.');
      // A senha digitada e descartada mesmo quando a API falha.
      setForm(p=>({...p,password:''}));
    }finally{setBusy(false);}
  }

  async function change(manager:Manager){
    const next=manager.active!==1;
    if(!window.confirm(next
      ? 'Reativar o acesso de '+manager.display_name+' à empresa '+company.name+'?'
      : 'Suspender '+manager.display_name+'? As sessões atuais serão encerradas.'))return;
    setChanging(manager.id);setError('');setNotice('');
    try {
      const res=await fetch(endpoint+'/'+encodeURIComponent(manager.id)+'/status',{
        method:'PATCH',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify({active:next})
      });
      const result=await read<{success:boolean;active:boolean}>(res);
      if(!result.success)throw new Error('A alteração não foi confirmada.');
      setNotice(next?'Administrador reativado.':'Acesso suspenso e sessões revogadas.');
      await load();
    }catch(err){
      setError(err instanceof Error?err.message:'Erro ao alterar acesso.');
    }finally{setChanging('');}
  }

  return <div className="company-admins-overlay" role="presentation">
    <section className="company-admins-modal" role="dialog" aria-modal="true"
      aria-label={'Administradores de '+company.name}>
      <header className="company-admins-header">
        <div>
          <p>CR JORNADA · SUPERADMIN</p>
          <h2>Administradores da empresa</h2>
          <span>{company.name} · {company.slug}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar administradores"
          disabled={busy||!!changing}><X size={20}/></button>
      </header>
      <div className="company-admins-content">
        <div className="company-admins-security">
          <ShieldCheck size={19}/>
          <p>Os acessos ficam vinculados somente a esta empresa. Esta tela não altera funcionários nem registros de ponto.</p>
        </div>
        {error&&<p className="company-admins-error" role="alert">{error}</p>}
        {notice&&<p className="company-admins-success" role="status">{notice}</p>}
        <section className="company-admins-section">
          <div className="company-admins-section-head">
            <h3>Responsáveis cadastrados</h3>
            <button type="button" onClick={()=>void load()} disabled={loading||busy||!!changing}>
              <RefreshCw size={15}/> Atualizar
            </button>
          </div>
          {loading&&<p role="status">Consultando administradores…</p>}
          {!loading&&managers.length===0&&<p>Nenhum administrador cadastrado para esta empresa.</p>}
          {!loading&&managers.map(manager=><article key={manager.id}
            className="company-admins-manager">
            <div><strong>{manager.display_name}</strong>
              <small>Usuário: {manager.login}</small>
              {manager.email&&<small>{manager.email}</small>}
            </div>
            <span className={manager.active?'company-admins-active':'company-admins-inactive'}>
              {manager.active?'Ativo':'Suspenso'}
            </span>
            <button type="button"
              disabled={busy||!!changing||company.status==='archived'||
                (company.status!=='active'&&manager.active!==1)}
              onClick={()=>void change(manager)}>
              {changing===manager.id?'Aguarde…':manager.active?'Suspender acesso':'Reativar'}
            </button>
          </article>)}
        </section>
        <section className="company-admins-section">
          <h3><UserPlus size={18}/> Cadastrar administrador</h3>
          <p>O administrador usará o identificador da empresa, seu usuário e a senha para entrar no painel de escalas.</p>
          {company.status!=='active'
            ? <p className="company-admins-error">Ative esta empresa antes de cadastrar novos responsáveis.</p>
            : <form className="company-admins-form" onSubmit={create}>
              <label>Nome do responsável
                <input required minLength={3} maxLength={140}
                  value={form.name} autoComplete="off"
                  onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
              </label>
              <label>Nome de usuário
                <input required minLength={3} maxLength={120}
                  pattern="[a-zA-Z0-9._@+\-]+" title="Use letras sem acento, números, ponto, hífen ou @."
                  autoCapitalize="none" autoComplete="off" value={form.login}
                  onChange={e=>setForm(p=>({...p,login:e.target.value}))}/>
              </label>
              <label>E-mail (opcional)
                <input type="email" maxLength={254} autoComplete="off"
                  value={form.email}
                  onChange={e=>setForm(p=>({...p,email:e.target.value}))}/>
              </label>
              <label>Senha inicial (mínimo 12 caracteres)
                <div className="company-admins-password">
                  <input required minLength={12} maxLength={128}
                    autoComplete="new-password"
                    type={showPassword?'text':'password'} value={form.password}
                    onChange={e=>setForm(p=>({...p,password:e.target.value}))}/>
                  <button type="button" aria-label={showPassword?'Ocultar senha':'Mostrar senha'}
                    onClick={()=>setShowPassword(p=>!p)}>
                    {showPassword?<EyeOff size={17}/>:<Eye size={17}/>}
                  </button>
                </div>
              </label>
              <p className="company-admins-hint">A senha inicial deve ser transmitida ao responsável por um canal seguro. Não coloque senhas verdadeiras na prévia estática do Pages.</p>
              <button type="submit" className="company-admins-submit" disabled={busy}>
                <UserPlus size={16}/>{busy?'Cadastrando…':'Cadastrar responsável'}
              </button>
            </form>}
        </section>
        <p className="company-admins-hint">
          Acesso do responsável: <Link to="/empresa/entrar" onClick={onClose}>Área da empresa</Link>.
          O login funcional exige Worker e D1 próprios do CR JORNADA em homologação.
        </p>
      </div>
    </section>
  </div>;
}
