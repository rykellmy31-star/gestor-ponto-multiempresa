
import React, {
  useCallback,
  useEffect,
  useState
} from 'react';

import {
  Link,
  Navigate
} from 'react-router-dom';

import {
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Edit3,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X
} from 'lucide-react';

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

type CompanyStatus =
  | 'active'
  | 'suspended'
  | 'archived';

type CompanyTimezone =
  | 'America/Bahia'
  | 'America/Sao_Paulo';

type Company = {
  id: string;
  name: string;
  document: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  timezone: CompanyTimezone;
  status: CompanyStatus;
  created_at: number;
  updated_at: number;
};

type CompanyForm = {
  name: string;
  document: string;
  slug: string;
  logo_url: string;
  primary_color: string;
  timezone: CompanyTimezone;
};

const initialForm: CompanyForm = {
  name: '',
  document: '',
  slug: '',
  logo_url: '',
  primary_color: '#0F766E',
  timezone: 'America/Bahia'
};

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: 'America/Bahia'
  }).format(new Date(timestamp));
}

async function getErrorMessage(
  response: Response,
  fallback: string
) {
  const data: { error?: { code?: string; message?: string } } | null =
    await response.json().catch(() => null);

  if (response.status === 401) {
    return 'Sua sessão expirou. Entre novamente.';
  }

  if (response.status === 403) {
    return 'Ação não autorizada. Atualize a página e tente novamente.';
  }

  if (response.status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos.';
  }

  return data?.error?.message || fallback;
}

async function requestSession(): Promise<Session | null> {
  const response = await fetch(
    '/api/platform/auth/session',
    { credentials: 'same-origin' }
  );

  if (response.status === 401) return null;

  if (!response.ok) {
    throw new Error(
      'Não foi possível verificar sua sessão.'
    );
  }

  return response.json();
}

function CompanyBadge({
  status
}: {
  status: CompanyStatus;
}) {
  const labels: Record<CompanyStatus, string> = {
    active: 'Ativa',
    suspended: 'Suspensa',
    archived: 'Arquivada'
  };

  const color =
    status === 'active'
      ? '#15803d'
      : status === 'suspended'
        ? '#b45309'
        : '#64748b';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 999,
        color,
        background: `${color}15`,
        fontWeight: 700,
        fontSize: 12
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color
        }}
      />
      {labels[status]}
    </span>
  );
}

function CompanyAvatar({
  company
}: {
  company: Company;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [company.logo_url]);

  return (
    <div
      style={{
        width: 48,
        height: 48,
        minWidth: 48,
        borderRadius: 14,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        background: company.primary_color,
        color: '#fff',
        fontWeight: 800
      }}
    >
      {company.logo_url && !failed ? (
        <img
          src={company.logo_url}
          alt={`Logo de ${company.name}`}
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
      ) : (
        company.name.slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

export function PlatformPage() {
  const [session, setSession] =
    useState<Session | null>(null);

  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [companies, setCompanies] =
    useState<Company[]>([]);

  const [companiesLoading, setCompaniesLoading] =
    useState(false);

  const [companiesError, setCompaniesError] =
    useState('');

  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [form, setForm] =
    useState<CompanyForm>(initialForm);

  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] =
    useState<string | null>(null);

  async function refreshSession() {
    const result = await requestSession();
    setSession(result);
    return result;
  }

  const loadCompanies = useCallback(async () => {
    if (!session) return;

    setCompaniesLoading(true);
    setCompaniesError('');

    try {
      const response = await fetch(
        '/api/platform/companies',
        { credentials: 'same-origin' }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            'Não foi possível carregar as empresas.'
          )
        );
      }

      const data: { companies: Company[] } =
        await response.json();

      setCompanies(data.companies || []);
    } catch (err) {
      setCompaniesError(
        err instanceof Error
          ? err.message
          : 'Erro ao carregar empresas.'
      );
    } finally {
      setCompaniesLoading(false);
    }
  }, [session]);

  useEffect(() => {
    let active = true;

    requestSession()
      .then(result => {
        if (active) setSession(result);
      })
      .catch(() => {
        if (active) {
          setError(
            'Não foi possível conectar ao servidor.'
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session?.user.role === 'superadmin') {
      void loadCompanies();
    }
  }, [session, loadCompanies]);

  async function handleLogin(
    event: React.FormEvent
  ) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(
        '/api/platform/auth/login',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            login: login.trim(),
            password
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            'Usuário ou senha inválidos.'
          )
        );
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
      const response = await fetch(
        '/api/platform/auth/logout',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'X-CSRF-Token': session.csrf_token
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            'Não foi possível encerrar a sessão.'
          )
        );
      }

      setSession(null);
      setCompanies([]);
      setPassword('');
      setFormOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao sair.'
      );
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...initialForm });
    setFormError('');
    setNotice('');
    setFormOpen(true);
  }

  function openEdit(company: Company) {
    if (company.status === 'archived') return;

    setEditingId(company.id);
    setForm({
      name: company.name,
      document: company.document,
      slug: company.slug,
      logo_url: company.logo_url || '',
      primary_color: company.primary_color,
      timezone: company.timezone
    });
    setFormError('');
    setNotice('');
    setFormOpen(true);
  }

  function updateForm<K extends keyof CompanyForm>(
    key: K,
    value: CompanyForm[K]
  ) {
    setForm(previous => ({
      ...previous,
      [key]: value
    }));
  }

  async function handleSave(
    event: React.FormEvent
  ) {
    event.preventDefault();

    if (!session) return;

    setSaving(true);
    setFormError('');
    setNotice('');

    try {
      const response = await fetch(
        editingId
          ? `/api/platform/companies/${editingId}`
          : '/api/platform/companies',
        {
          method: editingId ? 'PUT' : 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': session.csrf_token
          },
          body: JSON.stringify({
            ...form,
            name: form.name.trim(),
            document: form.document.trim(),
            slug: form.slug.trim().toLowerCase(),
            logo_url: form.logo_url.trim() || null
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            'Não foi possível salvar a empresa.'
          )
        );
      }

      setFormOpen(false);
      setEditingId(null);

      setNotice(
        editingId
          ? 'Empresa atualizada com sucesso.'
          : 'Empresa cadastrada com sucesso.'
      );

      await loadCompanies();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Erro ao salvar empresa.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(company: Company) {
    if (!session || company.status === 'archived') {
      return;
    }

    const nextStatus =
      company.status === 'active'
        ? 'suspended'
        : 'active';

    const confirmed = window.confirm(
      nextStatus === 'suspended'
        ? `Deseja suspender a empresa "${company.name}"?\n\nA suspensão será registrada, mas o bloqueio dos usuários depende da integração multiempresa.`
        : `Deseja ativar a empresa "${company.name}"?`
    );

    if (!confirmed) return;

    setChangingId(company.id);
    setCompaniesError('');
    setNotice('');

    try {
      const response = await fetch(
        `/api/platform/companies/${company.id}/status`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': session.csrf_token
          },
          body: JSON.stringify({
            status: nextStatus
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            'Não foi possível alterar a situação.'
          )
        );
      }

      setNotice(
        nextStatus === 'active'
          ? 'Empresa ativada com sucesso.'
          : 'Empresa suspensa no cadastro.'
      );

      await loadCompanies();
    } catch (err) {
      setCompaniesError(
        err instanceof Error
          ? err.message
          : 'Erro ao alterar situação.'
      );
    } finally {
      setChangingId(null);
    }
  }

  const filteredCompanies = companies.filter(company => {
    const term = search.toLowerCase().trim();

    return (
      company.name.toLowerCase().includes(term) ||
      company.slug.toLowerCase().includes(term) ||
      company.document.toLowerCase().includes(term)
    );
  });

  const activeCount = companies.filter(
    company => company.status === 'active'
  ).length;

  const suspendedCount = companies.filter(
    company => company.status === 'suspended'
  ).length;

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
            Entre com suas credenciais para
            gerenciar as empresas da plataforma.
          </p>

          <form onSubmit={handleLogin}>
            <label htmlFor="platform-login">
              Usuário
            </label>

            <input
              id="platform-login"
              value={login}
              onChange={event =>
                setLogin(event.target.value)
              }
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
              onChange={event =>
                setPassword(event.target.value)
              }
              autoComplete="current-password"
              required
            />

            {error && (
              <p
                role="alert"
                className="platform-error"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="platform-button"
              disabled={submitting}
            >
              {submitting
                ? 'Entrando...'
                : 'Entrar no painel'}
            </button>
          </form>

          <Link
            to="/admin/entrar"
            className="platform-link"
          >
            Acesso da empresa
          </Link>
        </section>
      </main>
    );
  }

  if (session.user.role !== 'superadmin') {
    return (
      <Navigate
        to="/admin/entrar"
        replace
      />
    );
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
          type="button"
          className="platform-logout"
          onClick={handleLogout}
        >
          <LogOut size={16} />
          {' '}Sair
        </button>
      </header>

      <div className="platform-content">
        <div className="platform-welcome">
          <p>Bem-vindo à plataforma</p>
          <h2>{session.user.name}</h2>
          <span>
            Controle as empresas cadastradas
            no CR JORNADA.
          </span>
        </div>

        {error && (
          <p
            role="alert"
            className="platform-error"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            style={{
              padding: 14,
              borderRadius: 12,
              background: '#ecfdf5',
              color: '#166534',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <CheckCircle2 size={18} />
            {notice}
          </p>
        )}

        <div className="platform-grid">
          <article className="platform-stat">
            <span>Empresas cadastradas</span>
            <strong>
              {companiesLoading ? '...' : companies.length}
            </strong>
            <small>Total de cadastros</small>
          </article>

          <article className="platform-stat">
            <span>Empresas ativas</span>
            <strong>
              {companiesLoading ? '...' : activeCount}
            </strong>
            <small>Cadastros ativos</small>
          </article>

          <article className="platform-stat">
            <span>Empresas suspensas</span>
            <strong>
              {companiesLoading ? '...' : suspendedCount}
            </strong>
            <small>Cadastros suspensos</small>
          </article>
        </div>

        <section className="platform-section">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 14
            }}
          >
            <div>
              <h3>
                <Building2
                  size={21}
                  style={{
                    verticalAlign: 'middle',
                    marginRight: 8
                  }}
                />
                Gerenciamento de empresas
              </h3>

              <p>
                Cadastre, personalize e gerencie
                suas empresas.
              </p>
            </div>

            <button
              type="button"
              className="platform-button"
              onClick={openCreate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                width: 'auto'
              }}
            >
              <Plus size={18} />
              Nova empresa
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 22,
              marginBottom: 20,
              flexWrap: 'wrap'
            }}
          >
            <div
              style={{
                flex: '1 1 230px',
                position: 'relative'
              }}
            >
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: 13,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: 0.5
                }}
              />

              <input
                aria-label="Pesquisar empresas"
                placeholder="Buscar por nome, CNPJ ou endereço..."
                value={search}
                onChange={event =>
                  setSearch(event.target.value)
                }
                style={{
                  width: '100%',
                  paddingLeft: 40,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => void loadCompanies()}
              disabled={companiesLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 10,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={16} />
              Atualizar
            </button>
          </div>

          {companiesError && (
            <p
              role="alert"
              className="platform-error"
            >
              <CircleAlert
                size={17}
                style={{
                  verticalAlign: 'middle',
                  marginRight: 6
                }}
              />
              {companiesError}
            </p>
          )}

          {!companiesLoading &&
            !companiesError &&
            companies.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '45px 20px'
                }}
              >
                <Building2
                  size={42}
                  style={{
                    opacity: 0.35,
                    marginBottom: 12
                  }}
                />

                <h3>Nenhuma empresa cadastrada</h3>

                <p>
                  Comece cadastrando a primeira
                  empresa do CR JORNADA.
                </p>

                <button
                  type="button"
                  className="platform-button"
                  onClick={openCreate}
                  style={{
                    width: 'auto',
                    marginTop: 12
                  }}
                >
                  Cadastrar empresa
                </button>
              </div>
            )}

          {filteredCompanies.length > 0 && (
            <div
              style={{
                display: 'grid',
                gap: 12
              }}
            >
              {filteredCompanies.map(company => (
                <article
                  key={company.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 16,
                    padding: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 13,
                      minWidth: 0,
                      flex: '1 1 220px'
                    }}
                  >
                    <CompanyAvatar company={company} />

                    <div style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: 16,
                          overflowWrap: 'anywhere'
                        }}
                      >
                        {company.name}
                      </strong>

                      <small
                        style={{
                          display: 'block',
                          opacity: 0.7,
                          marginTop: 3,
                          overflowWrap: 'anywhere'
                        }}
                      >
                        {company.document || 'Sem documento'}
                      </small>

                      <small
                        style={{
                          display: 'block',
                          opacity: 0.65,
                          marginTop: 3
                        }}
                      >
                        Código: {company.slug}
                      </small>
                    </div>
                  </div>

                  <div>
                    <CompanyBadge status={company.status} />

                    <small
                      style={{
                        display: 'block',
                        marginTop: 7,
                        opacity: 0.65
                      }}
                    >
                      Desde {formatDate(company.created_at)}
                    </small>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => openEdit(company)}
                      disabled={company.status === 'archived'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '9px 12px',
                        borderRadius: 9,
                        cursor: 'pointer'
                      }}
                    >
                      <Edit3 size={15} />
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() => void changeStatus(company)}
                      disabled={
                        changingId === company.id ||
                        company.status === 'archived'
                      }
                      style={{
                        padding: '9px 12px',
                        borderRadius: 9,
                        cursor: 'pointer'
                      }}
                    >
                      {changingId === company.id
                        ? 'Aguarde...'
                        : company.status === 'active'
                          ? 'Suspender'
                          : company.status === 'suspended'
                            ? 'Ativar'
                            : 'Arquivada'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!companiesLoading &&
            companies.length > 0 &&
            filteredCompanies.length === 0 && (
              <p>
                Nenhuma empresa corresponde à pesquisa.
              </p>
            )}
        </section>

        <section className="platform-section">
          <h3>
            <ShieldCheck
              size={20}
              style={{
                verticalAlign: 'middle',
                marginRight: 8
              }}
            />
            Administração da plataforma
          </h3>

          <p>
            O cadastro das empresas está integrado à
            API do Superadmin. A vinculação de
            administradores, funcionários e registros
            de ponto por empresa será implementada
            nas próximas etapas.
          </p>

          <span className="platform-pending">
            Integração multiempresa em desenvolvimento
          </span>
        </section>
      </div>

      {formOpen && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.68)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-dialog-title"
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: 'calc(100vh - 32px)',
              overflowY: 'auto',
              background: '#fff',
              color: '#0f172a',
              borderRadius: 20,
              padding: 24,
              boxSizing: 'border-box',
              boxShadow: '0 24px 80px rgba(0,0,0,0.2)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12
              }}
            >
              <div>
                <h2 id="company-dialog-title">
                  {editingId
                    ? 'Editar empresa'
                    : 'Cadastrar empresa'}
                </h2>

                <p>
                  Configure os dados e a identidade
                  visual da empresa.
                </p>
              </div>

              <button
                type="button"
                aria-label="Fechar formulário"
                onClick={() => setFormOpen(false)}
                disabled={saving}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <X size={24} />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              style={{
                display: 'grid',
                gap: 12,
                marginTop: 20
              }}
            >
              <label htmlFor="company-name">
                Nome da empresa
              </label>

              <input
                id="company-name"
                value={form.name}
                onChange={event => {
                  const value = event.target.value;

                  setForm(previous => ({
                    ...previous,
                    name: value,
                    slug: editingId
                      ? previous.slug
                      : slugify(value)
                  }));
                }}
                placeholder="Ex.: Farmácia Pague Pouco"
                minLength={2}
                maxLength={150}
                required
              />

              <label htmlFor="company-document">
                CNPJ ou documento
              </label>

              <input
                id="company-document"
                value={form.document}
                onChange={event =>
                  updateForm(
                    'document',
                    event.target.value
                  )
                }
                placeholder="00.000.000/0000-00"
                maxLength={30}
              />

              <label htmlFor="company-slug">
                Identificador da empresa
              </label>

              <input
                id="company-slug"
                value={form.slug}
                onChange={event =>
                  updateForm(
                    'slug',
                    slugify(event.target.value)
                  )
                }
                placeholder="farmacia-pague-pouco"
                minLength={3}
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
              />

              <small style={{ opacity: 0.65 }}>
                Identificador único usado internamente
                para reconhecer a empresa.
              </small>

              <label htmlFor="company-logo">
                URL da logomarca (opcional)
              </label>

              <input
                id="company-logo"
                type="url"
                value={form.logo_url}
                onChange={event =>
                  updateForm(
                    'logo_url',
                    event.target.value
                  )
                }
                placeholder="https://exemplo.com/logo.png"
                pattern="https://.*"
              />

              <label htmlFor="company-color">
                Cor principal
              </label>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12
                }}
              >
                <input
                  id="company-color"
                  type="color"
                  value={form.primary_color}
                  onChange={event =>
                    updateForm(
                      'primary_color',
                      event.target.value
                    )
                  }
                  style={{
                    width: 55,
                    height: 44,
                    padding: 3,
                    cursor: 'pointer'
                  }}
                />

                <strong>{form.primary_color}</strong>
              </div>

              <label htmlFor="company-timezone">
                Fuso horário
              </label>

              <select
                id="company-timezone"
                value={form.timezone}
                onChange={event =>
                  updateForm(
                    'timezone',
                    event.target.value as CompanyTimezone
                  )
                }
              >
                <option value="America/Bahia">
                  Bahia
                </option>

                <option value="America/Sao_Paulo">
                  São Paulo
                </option>
              </select>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 12,
                  borderRadius: 10,
                  background: '#f1f5f9',
                  fontSize: 13,
                  marginTop: 8
                }}
              >
                <Clock3 size={18} />

                {editingId
                  ? 'As alterações serão registradas na auditoria.'
                  : 'A empresa será cadastrada inicialmente como ativa.'}
              </div>

              {formError && (
                <p
                  role="alert"
                  className="platform-error"
                >
                  {formError}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  marginTop: 10,
                  flexWrap: 'wrap'
                }}
              >
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  style={{
                    padding: '11px 18px',
                    borderRadius: 10,
                    cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="platform-button"
                  disabled={saving}
                  style={{ width: 'auto' }}
                >
                  {saving
                    ? 'Salvando...'
                    : editingId
                      ? 'Salvar alterações'
                      : 'Cadastrar empresa'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
