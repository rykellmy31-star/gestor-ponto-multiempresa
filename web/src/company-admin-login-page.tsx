import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { AuthFrame } from './auth-pages';
import { jsonRequest } from './company-schedules-network';
import { Button, Field, InlineError } from './ui';

type CompanySession = { company: { slug: string } };

export function CompanyAdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [company, setCompany] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const notice = (location.state as { notice?: unknown } | null)?.notice;

  useEffect(() => {
    let active = true;
    jsonRequest<CompanySession>('/company/auth/session')
      .then(() => {
        if (active) navigate('/empresa/jornadas', { replace: true });
      })
      .catch(() => {})
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [navigate]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || checking) return;
    setBusy(true);
    setError(null);
    const slug = company.trim().toLowerCase();
    try {
      const result = await jsonRequest<{ success: boolean }>('/company/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: slug, login: login.trim(), password })
      });
      if (!result.success) throw new Error('Não foi possível confirmar o acesso.');
      const session = await jsonRequest<CompanySession>('/company/auth/session');
      if (session.company.slug.toLowerCase() !== slug) {
        throw new Error('A empresa da sessão não corresponde à informada. Entre novamente.');
      }
      navigate('/empresa/jornadas', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  return <AuthFrame admin>
    <div className="auth-area-tag"><ShieldCheck size={15}/> ACESSO ADMINISTRATIVO</div>
    <h2>Gestão em boas mãos.</h2>
    <p className="auth-description">
      Entre com sua conta administrativa para gerenciar a equipe.
    </p>
    {typeof notice === 'string' && <p role="status" className="company-schedules-notice">{notice}</p>}
    {checking ? <p role="status">Conferindo acesso empresarial…</p> : <form onSubmit={signIn}>
      <Field label="Identificador da empresa">
        <input name="company" value={company} onChange={e => setCompany(e.target.value)}
          placeholder="exemplo: minha-empresa" autoComplete="organization" required maxLength={60}/>
      </Field>
      <Field label="Usuário ou e-mail">
        <input name="login" value={login} onChange={e => setLogin(e.target.value)}
          placeholder="Seu usuário administrativo" autoComplete="username" required maxLength={200}/>
      </Field>
      <div className="password-heading"><span>Senha</span></div>
      <div className="password-input">
        <input aria-label="Senha" name="password" type={showPassword ? 'text' : 'password'}
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Digite sua senha" autoComplete="current-password" required maxLength={128}/>
        <button type="button" onClick={() => setShowPassword(v => !v)}
          aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
          {showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}
        </button>
      </div>
      <InlineError error={error}/>
      <Button className="btn-full auth-submit" busy={busy}>
        Entrar no painel <ArrowRight size={18}/>
      </Button>
    </form>}
    <p className="auth-description" style={{ marginTop: 14 }}>
      Esqueceu a senha? Solicite a redefinição ao Superadmin da plataforma.
    </p>
    <div className="auth-security"><ShieldCheck size={16}/>
      <span>Dados acessíveis somente com autenticação.</span>
    </div>
    <div className="auth-divider"/>
    <p className="auth-switch">Vai registrar seu ponto?{' '}
      <Link to="/funcionario">Portal do funcionário <ArrowRight size={14}/></Link>
    </p>
  </AuthFrame>;
}
