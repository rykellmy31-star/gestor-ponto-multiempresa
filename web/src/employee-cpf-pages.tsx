import { useCallback, useEffect, useId, useState, type FormEvent, type CSSProperties } from 'react';
import { Building2, CheckCircle2, Clock3, Eye, EyeOff, LogOut, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmployeeCpfPointHistory } from './employee-cpf-history';
import { EmployeeCpfPunch } from './employee-cpf-punch';
import { employeeCpfSessionEndpointUnavailable } from './employee-cpf-ui-safety';

type CompanyChoice = { id: string; name: string };
type EmployeeSession = {
  user: {
    id: string;
    employee_id: string;
    name: string;
    role: 'employee';
    must_change_password: boolean;
  };
  company: { id: string; name: string; slug: string; timezone?: 'America/Bahia' | 'America/Sao_Paulo' };
  csrf_token: string;
  expires_at: number;
};

type LoginResult = {
  success: boolean;
  selection_required: boolean;
  companies?: CompanyChoice[];
};

async function requestEmployee<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: object,
  csrf?: string
): Promise<T> {
  const response = await fetch('/api/employee/cpf-auth' + path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  // Sites Pages estaticos podem retornar HTML/404 para a rota de API.
  // Isso nao se confunde com uma sessao simplesmente nao autenticada (401).
  if(path==='/session'&&employeeCpfSessionEndpointUnavailable(
    response.status,response.headers.get('Content-Type')
  )) throw new Error('employee_api_unavailable');
  const data = await response.json().catch(() => null) as
    | (T & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    if (response.status === 401 && path === '/session') {
      throw new Error('not_authenticated');
    }
    throw new Error(
      data?.error?.message ||
      (response.status === 429
        ? 'Muitas tentativas. Aguarde alguns minutos.'
        : 'Não foi possível concluir a operação. Tente novamente.')
    );
  }
  if (!data) throw new Error('Resposta inesperada do servidor.');
  return data;
}

const panel: CSSProperties = {
  maxWidth: 470, width: '100%', background: '#fff', borderRadius: 20,
  border: '1px solid #eee3e3', padding: 'clamp(22px, 5vw, 38px)',
  boxShadow: '0 20px 80px #3f11110d'
};
const field: CSSProperties = {
  width: '100%', minHeight: 46, border: '1px solid #dfd3d3',
  borderRadius: 10, background: '#fff', padding: '12px 13px',
  fontSize: 15, color: '#302222'
};
const primary: CSSProperties = {
  width: '100%', minHeight: 46, border: 0, borderRadius: 10,
  padding: '12px 18px', background: '#800000', color: 'white',
  fontSize: 14, fontWeight: 650, display: 'flex',
  justifyContent: 'center', alignItems: 'center', gap: 9
};

export function EmployeeCpfPage() {
  const fieldId=useId();
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [checking, setChecking] = useState(true);
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<CompanyChoice[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSessionExpired=useCallback(()=>{
    setSession(null);
    setCompanies([]);
    setPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('Sua sessão expirou. Entre novamente para continuar.');
  },[]);

  async function refreshSession() {
    const data = await requestEmployee<EmployeeSession>('/session');
    setSession(data);
    setCompanies([]);
    setPassword('');
  }

  useEffect(() => {
    let active = true;
    requestEmployee<EmployeeSession>('/session').then(data => {
      if (active) { setBackendAvailable(true); setSession(data); }
    }).catch(err => {
      if(!active||!(err instanceof Error))return;
      if(err.message==='employee_api_unavailable'){
        setBackendAvailable(false);
        setError('');
      }else if(err.message!=='not_authenticated')setError(err.message);
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!backendAvailable) return;
    setError('');
    setBusy(true);
    try {
      const result = await requestEmployee<LoginResult>(
        '/login', 'POST', { cpf, password }
      );
      setPassword('');
      if (result.selection_required) {
        setCompanies(result.companies || []);
      } else {
        await refreshSession();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no acesso.');
    } finally {
      setBusy(false);
    }
  }

  async function selectCompany(id: string) {
    setError('');
    setBusy(true);
    try {
      await requestEmployee('/select', 'POST', { company_id: id });
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível selecionar a empresa.');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('As novas senhas não conferem.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await requestEmployee('/password', 'POST', {
        current_password: currentPassword,
        new_password: newPassword
      }, session?.csrf_token);
      setSession(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassword('');
      setCompanies([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await requestEmployee('/logout', 'POST', {}, session.csrf_token);
      setSession(null);
      setCompanies([]);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível sair.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={'cr-legacy-employee-page'+(session&&!session.user.must_change_password?' is-authenticated':'')} style={{
      minHeight: '100dvh', padding: '35px 16px', background: '#fbf7f7',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      color: '#302222'
    }}>
      {session&&!session.user.must_change_password&&<aside className="cr-legacy-sidebar" aria-label="Menu do funcionário">
        <div className="cr-legacy-sidebar-brand"><Clock3 size={25}/> CR JORNADA</div>
        <div className="cr-legacy-sidebar-title">PORTAL DO FUNCIONÁRIO</div>
        <nav className="cr-legacy-sidebar-nav">
          <a href="#cr-funcionario-ponto"><Clock3 size={17}/> Registrar ponto</a>
          <a href="#cr-funcionario-historico"><ShieldCheck size={17}/> Minha folha de ponto</a>
        </nav>
        <p className="cr-legacy-sidebar-note">Registros vinculados exclusivamente à empresa autenticada.</p>
      </aside>}
      <div className="cr-legacy-employee-content" style={panel}>
        <header className="cr-legacy-employee-header" style={{ textAlign: 'center', marginBottom: 28 }}>
          {!(session&&!session.user.must_change_password)&&<div style={{
            width: 58, height: 58, borderRadius: 16, margin: '0 auto 14px',
            display: 'grid', placeItems: 'center', color: '#fff',
            background: '#800000'
          }}><Clock3 size={28}/></div>}
          <div style={{ fontSize: 13, color: '#087f6f', fontWeight: 800, letterSpacing: 1.8 }}>
            CR JORNADA
          </div>
          <h1 style={{ marginTop: 10, fontSize: 25 }}>{session&&!session.user.must_change_password ? `Olá, ${session.user.name.split(' ')[0]}. Bom trabalho!` : 'Portal do funcionário'}</h1>
          <p style={{ color: '#777', fontSize: 13, marginTop: 8 }}>
            {session&&!session.user.must_change_password?'Registre seu ponto e acompanhe seu dia em um só lugar.':'Acesso seguro por CPF e senha'}
          </p>
        </header>

        {!backendAvailable && <div role="status" style={{
          background: '#fff8ed', border: '1px solid #f1dcc2',
          color: '#78542e', padding: 12, borderRadius: 9,
          marginBottom: 18, fontSize: 13
        }}>
          A API de autenticação do funcionário não foi encontrada neste endereço.
          Conecte o Worker e o banco de dados para liberar o login.
          Não informe CPF ou senha enquanto o acesso estiver indisponível.
        </div>}

        {error && <div role="alert" style={{
          color: '#921e1e', background: '#fff1f1', border: '1px solid #f1cece',
          padding: 12, borderRadius: 9, marginBottom: 18, fontSize: 13
        }}>{error}</div>}

        {checking ? (
          <p role="status" style={{ textAlign: 'center', color: '#666' }}>
            Verificando acesso…
          </p>
        ) : session?.user.must_change_password ? (
          <form onSubmit={changePassword}>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>
              <LockKeyhole size={18} style={{ verticalAlign: 'middle', marginRight: 6 }}/>
              Defina sua senha pessoal
            </h2>
            <p style={{ fontSize: 13, color: '#777', marginBottom: 20 }}>
              Por segurança, altere a senha inicial antes de continuar.
            </p>
            <label htmlFor={fieldId+'-current'} style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Senha atual</label>
            <input id={fieldId+'-current'} style={{ ...field, marginBottom: 15 }} type="password"
              autoComplete="current-password" value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)} maxLength={128} required/>
            <label htmlFor={fieldId+'-new'} style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Nova senha</label>
            <input id={fieldId+'-new'} style={{ ...field, marginBottom: 15 }} type="password"
              autoComplete="new-password" value={newPassword} minLength={12}
              onChange={e => setNewPassword(e.target.value)} maxLength={128} required/>
            <label htmlFor={fieldId+'-confirm'} style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Confirme sua nova senha</label>
            <input id={fieldId+'-confirm'} style={{ ...field, marginBottom: 20 }} type="password"
              autoComplete="new-password" value={confirmPassword} minLength={12}
              onChange={e => setConfirmPassword(e.target.value)} maxLength={128} required/>
            <button type="submit" style={primary} disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar senha e entrar novamente'}
            </button>
          </form>
        ) : session ? (
          <section className="cr-legacy-employee-dashboard">
            <div className="cr-legacy-status">
              <CheckCircle2 size={20}/> Acesso confirmado
            </div>
            <div className="cr-legacy-employee-company" style={{ padding: 15, background: '#faf4f4', borderRadius: 12, marginBottom: 18 }}>
              <p style={{ display: 'flex', gap: 9, alignItems: 'center', fontWeight: 700 }}>
                <Building2 size={18}/>{session.company.name}
              </p>
              <p style={{ marginTop: 9, fontSize: 13, color: '#777' }}>
                Sua sessão está vinculada exclusivamente a esta empresa.
              </p>
            </div>
            <div id="cr-funcionario-ponto" className="cr-legacy-employee-section"><EmployeeCpfPunch key={session.user.id + session.company.id}
              companyId={session.company.id}
              employeeId={session.user.employee_id}
              csrfToken={session.csrf_token}
              timezone={session.company.timezone}
              onConfirmed={() => setHistoryVersion(v => v + 1)}
              onSessionExpired={onSessionExpired}/></div>
            <div id="cr-funcionario-historico" className="cr-legacy-employee-section"><EmployeeCpfPointHistory key={session.company.id}
              companyId={session.company.id}
              employeeId={session.user.employee_id}
              timezone={session.company.timezone}
              refreshVersion={historyVersion}
              onSessionExpired={onSessionExpired}/></div>
            <button type="button" className="cr-legacy-logout" style={primary} onClick={logout} disabled={busy}>
              <LogOut size={18}/>{busy ? 'Saindo…' : 'Encerrar sessão'}
            </button>
          </section>
        ) : companies.length > 0 ? (
          <section>
            <h2 style={{ fontSize: 19, marginBottom: 9 }}>Escolha sua empresa</h2>
            <p style={{ fontSize: 13, color: '#777', marginBottom: 18 }}>
              Sua senha foi validada para mais de um vínculo.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {companies.map(company => (
                <button key={company.id} type="button" disabled={busy}
                  onClick={() => selectCompany(company.id)}
                  style={{
                    ...field, cursor: 'pointer', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 11
                  }}>
                  <Building2 color="#800000" size={18}/>{company.name}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy} onClick={() => {
              setCompanies([]); setPassword(''); setError('');
            }} style={{
              background: 'none', border: 0, padding: '18px 0 0',
              color: '#800000', fontWeight: 650
            }}>Voltar ao login</button>
          </section>
        ) : (
          <form onSubmit={login}>
            <label htmlFor={fieldId+'-cpf'} style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>CPF</label>
            <input id={fieldId+'-cpf'} style={{ ...field, marginBottom: 18 }}
              type="text" inputMode="numeric" autoComplete="username"
              placeholder="000.000.000-00" value={cpf}
              onChange={e => setCpf(e.target.value)} maxLength={14} required/>
            <label htmlFor={fieldId+'-password'} style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Senha</label>
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input id={fieldId+'-password'} style={{ ...field, paddingRight: 50 }}
                type={showPassword ? 'text' : 'password'}
                placeholder="Digite sua senha" value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" maxLength={128} required/>
              <button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                onClick={() => setShowPassword(v => !v)}
                style={{
                  background: 'transparent', border: 0, color: '#866',
                  position: 'absolute', top: 8, right: 9, padding: 5
                }}>{showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}</button>
            </div>
            <button type="submit" disabled={busy || !backendAvailable} style={primary}>
              {!backendAvailable ? 'Login indisponível sem API' : busy ? 'Conferindo…' : 'Entrar com segurança'}
            </button>
            <p style={{fontSize:12,color:'#777',lineHeight:1.6,marginTop:14}}>
              Esqueceu sua senha? Solicite ajuda ao administrador da sua empresa.
            </p>
            <Link to="/admin/entrar" style={{
              width: '100%', minHeight: 46, marginTop: 14, padding: '12px 16px',
              border: '1px solid #800000', borderRadius: 10, background: '#fff',
              color: '#800000', fontSize: 14, fontWeight: 650, textDecoration: 'none',
              display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 9
            }}>
              <Building2 size={18}/>
              Acessar área da empresa
            </Link>
            <p style={{fontSize:12,color:'#777',lineHeight:1.6,marginTop:9,textAlign:'center'}}>
              Administradores entram com o identificador, usuário e senha da empresa.
            </p>
          </form>
        )}

        <footer style={{
          marginTop: 26, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 7, fontSize: 11, color: '#888'
        }}>
          <ShieldCheck size={15}/> Acesso protegido · CR JORNADA
        </footer>
      </div>
    </main>
  );
}
