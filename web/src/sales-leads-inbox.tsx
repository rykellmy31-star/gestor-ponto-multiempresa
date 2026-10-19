import { useEffect, useState } from 'react';
import { Inbox, RefreshCw, Trash2, Mail, CheckCircle2 } from 'lucide-react';
import './sales-leads-inbox.css';

type Lead = {
  id: string;
  name: string;
  email: string;
  company: string;
  message: string;
  plan_id: string;
  status: 'new' | 'contacted' | 'closed';
  created_at: number;
};

const statuses: Record<Lead['status'], string> = {
  new: 'Novo',
  contacted: 'Respondido',
  closed: 'Encerrado'
};

export function SalesLeadsInbox({ csrfToken }: { csrfToken: string }) {
  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/platform/leads', {
        credentials: 'same-origin', cache: 'no-store'
      });
      if (!response.ok) throw new Error('Não foi possível consultar as solicitações comerciais.');
      const data = await response.json() as { leads: Lead[] };
      setItems(data.leads);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (open && !loaded) void load();
    // Carregar apenas após a ação do Superadmin para evitar acesso desnecessário.
  }, [open, loaded]);

  async function change(item: Lead, status: Lead['status']) {
    setBusy(item.id); setError('');
    try {
      const r = await fetch('/api/platform/leads/' + encodeURIComponent(item.id), {
        method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ status })
      });
      if (!r.ok) throw new Error('Não foi possível atualizar o atendimento.');
      setItems(current => current.map(lead =>
        lead.id === item.id ? { ...lead, status } : lead
      ));
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Erro ao atualizar.');
    } finally { setBusy(''); }
  }

  async function remove(item: Lead) {
    if (!window.confirm(
      'Excluir definitivamente a solicitação de ' + item.name + '? Esta ação não poderá ser desfeita.'
    )) return;
    setBusy(item.id); setError('');
    try {
      const r = await fetch('/api/platform/leads/' + encodeURIComponent(item.id), {
        method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-CSRF-Token': csrfToken }
      });
      if (!r.ok) throw new Error('Não foi possível excluir a solicitação.');
      setItems(current => current.filter(lead => lead.id !== item.id));
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir.');
    } finally { setBusy(''); }
  }

  const pending = items.filter(item => item.status === 'new').length;
  return <section className="sales-inbox">
    <div className="sales-inbox-head">
      <div>
        <h3><Inbox size={20}/> Interessados na plataforma</h3>
        <p>Solicitações recebidas pelo formulário da página de vendas. Só o Superadmin tem acesso.</p>
      </div>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="sales-inbox-toggle">
        {open ? 'Fechar mensagens' : 'Ver mensagens'}
      </button>
    </div>
    {open && <>
      <div className="sales-inbox-toolbar">
        <span>{loaded ? items.length + ' solicitações • ' + pending + ' novas' : 'Solicitações comerciais'}</span>
        <button type="button" disabled={loading || !!busy} onClick={() => void load()}>
          <RefreshCw size={15}/> Atualizar
        </button>
      </div>
      {loading && <p role="status">Consultando as solicitações…</p>}
      {error && <p className="sales-inbox-error" role="alert">{error}</p>}
      {!loading && loaded && !items.length &&
        <p className="sales-inbox-empty">Nenhuma solicitação registrada até agora.</p>}
      {!loading && items.map(item => <article key={item.id} className="sales-inbox-item">
        <header>
          <div><strong>{item.name}</strong>
            <small>{item.company || 'Empresa não informada'} • {
              new Date(item.created_at).toLocaleString('pt-BR')}</small>
          </div>
          <span className={'sales-inbox-status sales-inbox-status-' + item.status}>
            {statuses[item.status]}
          </span>
        </header>
        <a className="sales-inbox-email" href={'mailto:' + item.email}>
          <Mail size={15}/> {item.email}
        </a>
        {item.plan_id && <p className="sales-inbox-plan">Plano de interesse: {item.plan_id}</p>}
        <p className="sales-inbox-message">{item.message}</p>
        <div className="sales-inbox-actions">
          {item.status !== 'contacted' && <button type="button"
            disabled={!!busy} onClick={() => void change(item, 'contacted')}>
            <CheckCircle2 size={16}/> Marcar como respondido
          </button>}
          {item.status !== 'closed' && <button type="button"
            disabled={!!busy} onClick={() => void change(item, 'closed')}>
            Encerrar
          </button>}
          <button type="button" className="sales-inbox-delete"
            disabled={!!busy} onClick={() => void remove(item)}>
            <Trash2 size={16}/> Excluir
          </button>
        </div>
      </article>)}
      <p className="sales-inbox-privacy">
        Use os dados somente para responder ao pedido comercial. Exclua solicitações que não sejam mais necessárias.
        A rotina automática de retenção será homologada antes de ativar o formulário em produção.
      </p>
    </>}
  </section>;
}
