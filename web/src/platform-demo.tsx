import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowLeft, Building2, CheckCircle2, CircleAlert,
  Clock3, Eye, LayoutDashboard, LockKeyhole, Plus,
  RefreshCcw, Search, ShieldCheck, SlidersHorizontal, X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  demoCompanies, demoCompanyCounts, normalizeDemoSlug,
  validateDemoCompany,
  type DemoCompany, type DemoCompanyDraft, type DemoCompanyStatus
} from './platform-demo-data';
import './platform-demo.css';

// Demonstracao inteiramente client-side. NAO reutiliza sessoes, senhas,
// identificadores de usuarios ou dados do D1 do sistema real.
const emptyDraft: DemoCompanyDraft = {
  name: '', slug: '', document: '',
  timezone: 'America/Bahia'
};
const statuses: Record<DemoCompanyStatus, string> = {
  active: 'Ativa', suspended: 'Suspensa', archived: 'Arquivada'
};

function Button({
  children, onClick, kind = 'primary', type = 'button', disabled = false
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'plain';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return <button type={type} disabled={disabled} onClick={onClick}
    className={'cr-demo-btn cr-demo-btn-' + kind}>{children}</button>;
}

export function PlatformDemoPage() {
  const [entered, setEntered] = useState(false);
  const [companies, setCompanies] = useState<DemoCompany[]>(() =>
    demoCompanies.map(company => ({ ...company }))
  );
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | DemoCompanyStatus>('all');
  const [editor, setEditor] = useState<string | null>(null);
  const [draft, setDraft] = useState<DemoCompanyDraft>({ ...emptyDraft });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'overview' | 'companies'>('overview');
  const stats = useMemo(() => demoCompanyCounts(companies), [companies]);
  const filtered = useMemo(() => companies.filter(company =>
    (filter === 'all' || company.status === filter) &&
    [company.name, company.slug, company.document].some(value =>
      value.toLowerCase().includes(search.trim().toLowerCase())
    )
  ), [companies, filter, search]);

  function resetDemo() {
    setCompanies(demoCompanies.map(company => ({ ...company })));
    setSearch(''); setFilter('all'); setEditor(null);
    setNotice('Dados fictícios restaurados. Nenhum banco foi alterado.');
    setError('');
  }
  function openNew() {
    setEditor('new'); setDraft({ ...emptyDraft });
    setNotice(''); setError('');
  }
  function openEdit(company: DemoCompany) {
    setEditor(company.id);
    setDraft({
      name: company.name, slug: company.slug,
      document: company.document, timezone: company.timezone
    });
    setError(''); setNotice('');
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const problem = validateDemoCompany(
      draft, companies, editor === 'new' ? undefined : editor || undefined
    );
    if (problem) { setError(problem); return; }
    const now = Date.now();
    const name = draft.name.trim();
    if (editor === 'new') {
      const company: DemoCompany = {
        id: 'demo-' + now + '-' + Math.random().toString(36).slice(2),
        name, slug: draft.slug, document: draft.document.trim(),
        timezone: draft.timezone, status: 'active', created_at: now
      };
      setCompanies(current => [...current, company]);
    } else if (editor) {
      setCompanies(current => current.map(company =>
        company.id === editor
          ? { ...company, name, slug: draft.slug,
              document: draft.document.trim(), timezone: draft.timezone }
          : company
      ));
    }
    setEditor(null);
    setNotice('Alteração aplicada apenas à demonstração, sem salvar no servidor.');
    setError('');
  }
  function setStatus(company: DemoCompany, status: DemoCompanyStatus) {
    setCompanies(current => current.map(item =>
      item.id === company.id ? { ...item, status } : item
    ));
    setNotice('Status simulado. Nenhuma empresa real foi modificada.');
    setError('');
  }

  return <main className="cr-demo-root">
    <div className="cr-demo-banner" role="status">
      <Eye size={17}/>
      <span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong> — Todos os dados são fictícios e desaparecem ao atualizar a página. Não existe autenticação real nesta tela.</span>
    </div>
    {!entered ? <section className="cr-demo-welcome">
      <div className="cr-demo-brand"><Clock3 size={26}/><span>CR JORNADA</span></div>
      <div className="cr-demo-welcome-box">
        <div className="cr-demo-big-icon"><ShieldCheck size={35}/></div>
        <p className="cr-demo-overline">PRÉVIA VISUAL DO PAINEL</p>
        <h1>Conheça o Superadmin</h1>
        <p>Explore a gestão de empresas e o painel da plataforma enquanto preparamos o ambiente de testes com banco de dados separado.</p>
        <div className="cr-demo-warning"><LockKeyhole size={19}/>
          Este acesso é apenas visual: não solicite nem digite seu usuário ou senha real.
        </div>
        <Button onClick={() => setEntered(true)}>
          <LayoutDashboard size={18}/> Abrir demonstração do painel
        </Button>
        <Link className="cr-demo-back" to="/superadmin">
          <ArrowLeft size={15}/> Voltar à página de login real
        </Link>
      </div>
    </section> : <div className="cr-demo-shell">
      <aside className="cr-demo-sidebar">
        <div className="cr-demo-brand"><Clock3 size={26}/><span>CR JORNADA</span></div>
        <p className="cr-demo-side-caption">PLATAFORMA MULTIEMPRESA</p>
        <nav aria-label="Menu da demonstração">
          <button className={tab === 'overview' ? 'active' : ''}
            onClick={() => setTab('overview')}><LayoutDashboard size={19}/> Visão geral</button>
          <button className={tab === 'companies' ? 'active' : ''}
            onClick={() => setTab('companies')}><Building2 size={19}/> Empresas</button>
        </nav>
        <div className="cr-demo-side-footer">
          <span><ShieldCheck size={16}/> Prévia sem dados reais</span>
          <Link to="/superadmin"><ArrowLeft size={15}/> Login de produção</Link>
        </div>
      </aside>

      <section className="cr-demo-main">
        <header className="cr-demo-header">
          <div><p className="cr-demo-overline">CR JORNADA · PAINEL SUPERADMIN</p>
            <h1>{tab === 'overview' ? 'Visão geral' : 'Gerenciamento de empresas'}</h1>
            <p>Ambiente demonstrativo — dados fictícios, sem acesso ao D1.</p>
          </div>
          <div className="cr-demo-header-actions">
            <Button kind="secondary" onClick={resetDemo}><RefreshCcw size={16}/> Reiniciar demo</Button>
            <Button onClick={openNew}><Plus size={17}/> Nova empresa</Button>
          </div>
        </header>

        {notice && <div className="cr-demo-notice" role="status">
          <CheckCircle2 size={18}/><span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={16}/></button>
        </div>}

        <div className="cr-demo-stats">
          <article><span><Building2 size={17}/> Empresas cadastradas</span><strong>{stats.total}</strong><small>Somente dados simulados</small></article>
          <article><span><CheckCircle2 size={17}/> Empresas ativas</span><strong>{stats.active}</strong><small>Prontas no cenário fictício</small></article>
          <article><span><CircleAlert size={17}/> Suspensas</span><strong>{stats.suspended}</strong><small>Acesso interrompido na simulação</small></article>
          <article><span><Activity size={17}/> Arquivadas</span><strong>{stats.archived}</strong><small>Registros demonstrativos</small></article>
        </div>

        {tab === 'overview' && <section className="cr-demo-overview">
          <article>
            <h2><SlidersHorizontal size={19}/> Gestão centralizada</h2>
            <p>Como superadministrador, você poderá administrar empresas, acompanhar status e controlar o acesso de cada organização.</p>
            <div className="cr-demo-overview-actions">
              <Button onClick={() => setTab('companies')} kind="secondary"><Building2 size={17}/> Gerenciar empresas</Button>
            </div>
          </article>
          <article>
            <h2><ShieldCheck size={19}/> Isolamento entre empresas</h2>
            <p>Na versão definitiva, cada empresa terá funcionários, escalas, registros e permissões isolados no backend.</p>
            <span className="cr-demo-hint">Em desenvolvimento — não disponível nesta prévia estática</span>
          </article>
        </section>}

        <section className="cr-demo-list-section">
          <div className="cr-demo-list-heading">
            <div><h2>Empresas de exemplo</h2>
              <p>Teste os filtros, cadastros e estados sem comprometer dados reais.</p>
            </div>
            <span>{filtered.length} resultados</span>
          </div>
          <div className="cr-demo-filters">
            <label><Search size={18}/><input
              aria-label="Pesquisar empresas" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar por nome ou identificador"/></label>
            <select aria-label="Filtrar empresas por situação"
              value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
              <option value="all">Todas as situações</option>
              <option value="active">Ativas</option>
              <option value="suspended">Suspensas</option>
              <option value="archived">Arquivadas</option>
            </select>
          </div>
          <div className="cr-demo-table-scroll">
            <table><thead><tr>
              <th>Empresa</th><th>Identificador</th><th>Situação</th><th>Ações simuladas</th>
            </tr></thead>
            <tbody>{filtered.map(company => <tr key={company.id}>
              <td><div className="cr-demo-company-name">
                <span className="cr-demo-avatar">{company.name.slice(0,1).toUpperCase()}</span>
                <span><strong>{company.name}</strong><small>{company.timezone.replace('_',' ')}</small></span>
              </div></td>
              <td>{company.slug}</td>
              <td><span className={'cr-demo-status cr-demo-status-' + company.status}>
                {statuses[company.status]}</span></td>
              <td><div className="cr-demo-row-actions">
                <Button kind="plain" onClick={() => openEdit(company)}>Editar</Button>
                {company.status !== 'active' && <Button kind="plain" onClick={() => setStatus(company,'active')}>Ativar</Button>}
                {company.status === 'active' && <Button kind="plain" onClick={() => setStatus(company,'suspended')}>Suspender</Button>}
                {company.status !== 'archived' && <Button kind="plain" onClick={() => setStatus(company,'archived')}>Arquivar</Button>}
              </div></td>
            </tr>)}</tbody></table>
          </div>
          {filtered.length === 0 && <p className="cr-demo-empty">Nenhuma empresa fictícia corresponde à pesquisa.</p>}
        </section>
      </section>
    </div>}

    {editor !== null && <div className="cr-demo-overlay" role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget) setEditor(null); }}>
      <section className="cr-demo-modal" role="dialog" aria-modal="true"
        aria-label={editor === 'new' ? 'Cadastrar empresa de exemplo' : 'Editar empresa de exemplo'}>
        <header><div><p className="cr-demo-overline">DADOS FICTÍCIOS</p>
          <h2>{editor === 'new' ? 'Nova empresa de exemplo' : 'Editar empresa de exemplo'}</h2>
        </div><button onClick={() => setEditor(null)} aria-label="Fechar"><X size={20}/></button></header>
        <p>Este formulário é uma simulação. As alterações não são enviadas a nenhum servidor.</p>
        <form onSubmit={save}>
          <label>Nome da empresa
            <input required maxLength={140} value={draft.name}
              onChange={e => {
                const name = e.target.value;
                setDraft(prev => ({
                  ...prev, name,
                  slug: (editor === 'new' ? normalizeDemoSlug(name) : prev.slug)
                }));
              }} placeholder="Nome fictício"/>
          </label>
          <label>Identificador
            <input required maxLength={60} value={draft.slug}
              onChange={e => setDraft(prev => ({
                ...prev, slug: normalizeDemoSlug(e.target.value)
              }))} placeholder="empresa-exemplo"/>
          </label>
          <label>Documento fictício (opcional)
            <input maxLength={32} value={draft.document}
              onChange={e => setDraft(prev => ({...prev, document: e.target.value}))}
              placeholder="Use apenas dados de teste"/>
          </label>
          <label>Fuso horário
            <select value={draft.timezone}
              onChange={e => setDraft(prev => ({
                ...prev, timezone: e.target.value as DemoCompanyDraft['timezone']
              }))}>
              <option value="America/Bahia">Bahia</option>
              <option value="America/Sao_Paulo">São Paulo</option>
            </select>
          </label>
          {error && <div className="cr-demo-error" role="alert">{error}</div>}
          <div className="cr-demo-modal-buttons">
            <Button kind="secondary" onClick={() => setEditor(null)}>Cancelar</Button>
            <Button type="submit"><CheckCircle2 size={17}/> Salvar na demonstração</Button>
          </div>
        </form>
      </section>
    </div>}
  </main>;
}
