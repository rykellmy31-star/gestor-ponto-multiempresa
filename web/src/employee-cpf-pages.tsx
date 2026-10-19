import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { Building2, CheckCircle2, Clock3, Eye, EyeOff, LogOut, LockKeyhole, ShieldCheck } from 'lucide-react';

type CompanyChoice = { id: string; name: string };
type EmployeeSession = {
  user: {
    id: string;
    employee_id: string;
    name: string;
    role: 'employee';
    must_change_password: boolean;
  };
  company: { id: string; name: string; slug: string };
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
  const staticPreview = window.location.hostname.endsWith('.pages.dev');
  const [session, setSession] = useState<EmployeeSession | null>(null);
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

  async function refreshSession() {
    const data = await requestEmployee<EmployeeSession>('/session');
    setSession(data);
    setCompanies([]);
    setPassword('');
  }

  useEffect(() => {
    if (staticPreview) {
      setChecking(false);
      return;
    }
    let active = true;
    requestEmployee<EmployeeSession>('/session').then(data => {
      if (active) setSession(data);
    }).catch(err => {
      if (active && err instanceof Error && err.message !== 'not_authenticated') {
        setError(err.message);
      }
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (staticPreview) return;
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
    <main style={{
      minHeight: '100dvh', padding: '35px 16px', background: '#fbf7f7',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      color: '#302222'
    }}>
      <div style={panel}>
        <header style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 58, height: 58, borderRadius: 16, margin: '0 auto 14px',
            display: 'grid', placeItems: 'center', color: '#fff',
            background: '#800000'
          }}><Clock3 size={28}/></div>
          <div style={{ fontSize: 13, color: '#800000', fontWeight: 800, letterSpacing: 1.8 }}>
            CR JORNADA
          </div>
          <h1 style={{ marginTop: 10, fontSize: 25 }}>Portal do funcionário</h1>
          <p style={{ color: '#777', fontSize: 13, marginTop: 8 }}>
            Acesso seguro por CPF e senha
          </p>
        </header>

        {staticPreview && <div role="status" style={{
          background: '#fff8ed', border: '1px solid #f1dcc2',
          color: '#78542e', padding: 12, borderRadius: 9,
          marginBottom: 18, fontSize: 13
        }}>
          Versão de demonstração visual. O login ficará disponível
          quando conectarmos um Worker e um banco de testes.
          Não utilize dados pessoais reais.
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
            <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Senha atual</label>
            <input style={{ ...field, marginBottom: 15 }} type="password"
              autoComplete="current-password" value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)} maxLength={128} required/>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Nova senha</label>
            <input style={{ ...field, marginBottom: 15 }} type="password"
              autoComplete="new-password" value={newPassword} minLength={12}
              onChange={e => setNewPassword(e.target.value)} maxLength={128} required/>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Confirme sua nova senha</label>
            <input style={{ ...field, marginBottom: 20 }} type="password"
              autoComplete="new-password" value={confirmPassword} minLength={12}
              onChange={e => setConfirmPassword(e.target.value)} maxLength={128} required/>
            <button type="submit" style={primary} disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar senha e entrar novamente'}
            </button>
          </form>
        ) : session ? (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0c7856' }}>
              <CheckCircle2 size={20}/> Acesso confirmado
            </div>
            <h2 style={{ fontSize: 21, margin: '18px 0 8px' }}>
              Olá, {session.user.name}
            </h2>
            <div style={{ padding: 15, background: '#faf4f4', borderRadius: 12, marginBottom: 18 }}>
              <p style={{ display: 'flex', gap: 9, alignItems: 'center', fontWeight: 700 }}>
                <Building2 size={18}/>{session.company.name}
              </p>
              <p style={{ marginTop: 9, fontSize: 13, color: '#777' }}>
                Sua sessão está vinculada exclusivamente a esta empresa.
              </p>
            </div>
            <p style={{ fontSize: 13, color: '#777', marginBottom: 22 }}>
              Autenticação habilitada na versão de desenvolvimento.
              A marcação de ponto será disponibilizada somente após
              a validação do isolamento dos registros.
            </p>
            <button type="button" style={primary} onClick={logout} disabled={busy}>
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
            <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>CPF</label>
            <input style={{ ...field, marginBottom: 18 }}
              type="text" inputMode="numeric" autoComplete="username"
              placeholder="000.000.000-00" value={cpf}
              onChange={e => setCpf(e.target.value)} maxLength={14} required/>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>Senha</label>
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <input style={{ ...field, paddingRight: 50 }}
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
            <button type="submit" disabled={busy || staticPreview} style={primary}>
              {staticPreview ? 'Login indisponível na prévia' : busy ? 'Conferindo…' : 'Entrar com segurança'}
            </button>
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
