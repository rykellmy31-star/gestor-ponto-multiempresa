
import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

type PlatformUser = {
  id: string;
  login: string;
  email: string | null;
  name: string;
  role: string;
};

type Session = {
  user: PlatformUser;
  csrf_token: string;
  expires_at: number;
};

async function requestSession(): Promise<Session | null> {
  const response = await fetch('/api/platform/auth/session', {
    credentials: 'same-origin'
  });

  if (response.status === 401) return null;

  if (!response.ok) {
    throw new Error('Não foi possível verificar sua sessão.');
  }

  return response.json();
}

export function PlatformPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function refreshSession() {
    const result = await requestSession();
    setSession(result);
    return result;
  }

  useEffect(() => {
    let active = true;

    requestSession()
      .then(result => {
        if (active) setSession(result);
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível conectar ao servidor.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/platform/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          login: login.trim(),
          password
        })
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            'Muitas tentativas. Aguarde alguns minutos.'
          );
        }

        throw new Error('Usuário ou senha inválidos.');
      }

      const result = await refreshSession();

      if (!result) {
        throw new Error(
          'Login realizado, mas a sessão não foi confirmada.'
        );
      }

      setPassword('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro inesperado ao entrar.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (!session) return;

    setError('');

    try {
      const response = await fetch('/api/platform/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': session.csrf_token
        }
      });

      if (!response.ok) {
        throw new Error('Não foi possível encerrar a sessão.');
      }

      setSession(null);
      setPassword('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao sair.'
      );
    }
  }

  if (loading) {
    return (
      <main className="full-loading">
        <p>Verificando acesso ao CR JORNADA...</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="platform-shell">
        <section className="platform-card">
          <div className="platform-brand">
            <div className="platform-logo">CR</div>
            <div>
              <h1>CR JORNADA</h1>
              <p>Administração da plataforma</p>
            </div>
          </div>

          <h2>Acesso Superadmin</h2>
          <p>
            Entre com suas credenciais para gerenciar
            as empresas da plataforma.
          </p>

          <form onSubmit={handleLogin}>
            <label htmlFor="platform-login">
              Usuário
            </label>
            <input
              id="platform-login"
              value={login}
              onChange={event => setLogin(event.target.value)}
              autoComplete="username"
              required
            />

            <label htmlFor="platform-password">
              Senha
            </label>
            <input
              id="platform-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />

            {error && (
              <p role="alert" className="platform-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="platform-button"
              disabled={submitting}
            >
              {submitting ? 'Entrando...' : 'Entrar no painel'}
            </button>
          </form>

          <Link to="/admin/entrar" className="platform-link">
            Acesso da empresa
          </Link>
        </section>
      </main>
    );
  }

  if (session.user.role !== 'superadmin') {
    return <Navigate to="/admin/entrar" replace />;
  }

  return (
    <main className="platform-dashboard">
      <header className="platform-header">
        <div className="platform-brand">
          <div className="platform-logo">CR</div>
          <div>
            <h1>CR JORNADA</h1>
            <p>Painel Superadministrador</p>
          </div>
        </div>

        <button
          className="platform-logout"
          onClick={handleLogout}
        >
          Sair
        </button>
      </header>

      <div className="platform-content">
        <div className="platform-welcome">
          <p>Bem-vindo à plataforma</p>
          <h2>{session.user.name}</h2>
          <span>
            Gerencie suas empresas em um só lugar.
          </span>
        </div>

        {error && (
          <p role="alert" className="platform-error">
            {error}
          </p>
        )}

        <div className="platform-grid">
          <article className="platform-stat">
            <span>Empresas</span>
            <strong>—</strong>
            <small>Aguardando integração</small>
          </article>

          <article className="platform-stat">
            <span>Funcionários</span>
            <strong>—</strong>
            <small>Aguardando integração</small>
          </article>
        </div>

        <section className="platform-section">
          <h3>Gerenciamento de empresas</h3>
          <p>
            Aqui você poderá cadastrar empresas,
            definir logomarcas, cores e administradores.
          </p>
          <span className="platform-pending">
            Funcionalidade em desenvolvimento
          </span>
        </section>

        <section className="platform-section">
          <h3>Configurações da plataforma</h3>
          <p>
            Personalize a identidade visual e gerencie
            os acessos do CR JORNADA.
          </p>
          <span className="platform-pending">
            Funcionalidade em desenvolvimento
          </span>
        </section>
      </div>
    </main>
  );
}
