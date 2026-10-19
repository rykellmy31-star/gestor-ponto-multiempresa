import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Send } from 'lucide-react';
import type { SalesPageConfig } from '../../shared/sales-page';
import './sales-lead-form.css';

export function SalesLeadForm({
  config, enabled
}: {
  config: SalesPageConfig;
  enabled: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/public/leads', {
        method: 'POST',
        credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, company, message, plan_id: plan,
          consent, website
        })
      });
      if (!response.ok) {
        throw new Error(response.status === 429
          ? 'Muitas tentativas. Aguarde um pouco e tente novamente.'
          : 'Não foi possível enviar sua solicitação. Tente novamente.');
      }
      setDone(true);
      setName(''); setEmail(''); setCompany(''); setMessage('');
      setPlan(''); setConsent(false); setWebsite('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar.');
    } finally { setBusy(false); }
  }

  if (done) return <div className="sales-lead-success" role="status">
    <CheckCircle2 size={28}/>
    <h3>Solicitação recebida!</h3>
    <p>Obrigado pelo interesse. A equipe comercial poderá consultar sua mensagem e responder pelo e-mail informado.</p>
  </div>;

  return <form onSubmit={submit} className="sales-lead-form">
    <div className="sales-lead-heading">
      <span>FALE SOBRE SUA EMPRESA</span>
      <h3>Peça mais informações.</h3>
      <p>Envie uma mensagem sem precisar usar WhatsApp. Este é um pedido de contato, não uma contratação.</p>
    </div>
    {!enabled && <p role="status" className="sales-lead-disabled">
      Formulário demonstrativo. O envio ficará disponível após a publicação oficial e a ativação pelo Superadmin.
    </p>}
    <div className="sales-lead-fields">
      <label>Seu nome
        <input value={name} onChange={e=>setName(e.target.value)}
          minLength={3} maxLength={100} required disabled={!enabled||busy}
          autoComplete="name" placeholder="Como podemos chamar você?"/>
      </label>
      <label>E-mail para resposta
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
          maxLength={254} required disabled={!enabled||busy}
          autoComplete="email" placeholder="voce@empresa.com.br"/>
      </label>
      <label>Nome da empresa (opcional)
        <input value={company} onChange={e=>setCompany(e.target.value)}
          maxLength={120} disabled={!enabled||busy}
          autoComplete="organization" placeholder="Sua empresa"/>
      </label>
      <label>Plano de interesse (opcional)
        <select value={plan} disabled={!enabled||busy} onChange={e=>setPlan(e.target.value)}>
          <option value="">Ainda estou conhecendo</option>
          {config.plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="sales-lead-full">Sua dúvida ou necessidade
        <textarea rows={4} value={message} minLength={12} maxLength={1000}
          onChange={e=>setMessage(e.target.value)} disabled={!enabled||busy}
          required placeholder="Conte um pouco sobre o que você precisa…"/>
      </label>
    </div>
    <div className="sales-lead-bot-field" aria-hidden="true">
      <label>Deixe este campo vazio
        <input value={website} onChange={e=>setWebsite(e.target.value)}
          tabIndex={-1} autoComplete="off" disabled={!enabled||busy}/>
      </label>
    </div>
    <label className="sales-lead-consent">
      <input type="checkbox" checked={consent} disabled={!enabled||busy}
        required onChange={e=>setConsent(e.target.checked)}/>
      <span>Autorizo o uso das informações enviadas exclusivamente para responder à minha solicitação comercial. Não envie CPF, senhas ou outros dados sensíveis.</span>
    </label>
    {error && <p className="sales-lead-error" role="alert">{error}</p>}
    <button className="sales-lead-submit" type="submit"
      disabled={!enabled||busy||!consent}>
      <Send size={17}/>{busy?'Enviando…':'Enviar solicitação'}<ArrowRight size={17}/>
    </button>
    <p className="sales-lead-footnote">
      Não realizamos cobrança por este formulário.
    </p>
  </form>;
}
