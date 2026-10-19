import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, ExternalLink, Eye, EyeOff, MessageCircle,
  Plus, Save, ShieldCheck, Trash2
} from 'lucide-react';
import {
  defaultSalesPage, salesPageSchema, whatsappUrl,
  type SalesPageConfig
} from '../../shared/sales-page';
import './sales-editor.css';

type AdminResponse = {
  config: SalesPageConfig;
  published: boolean;
  revision: number;
  updated_at: number | null;
};

function textLines(lines: string[]) { return lines.join('\n'); }
function fromLines(raw: string) {
  return raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}
function ensureHttps(url: string) {
  return !url || url.startsWith('https://');
}

export function SalesPageEditor({ csrfToken }: { csrfToken: string }) {
  const [config, setConfig] = useState<SalesPageConfig>(defaultSalesPage);
  const [published, setPublished] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/platform/sales-page', {
      credentials: 'same-origin', cache: 'no-store'
    }).then(async r => {
      if (!r.ok) throw new Error('Não foi possível carregar a configuração. O backend e a migração 0021 são necessários.');
      return r.json() as Promise<AdminResponse>;
    }).then(data => {
      if (!active) return;
      const parsed = salesPageSchema.safeParse(data.config);
      if (!parsed.success) throw new Error('A configuração recebida é inválida.');
      setConfig(parsed.data);
      setPublished(data.published);
      setRevision(data.revision);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Falha de conexão.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function update<K extends keyof SalesPageConfig>(
    name: K, value: SalesPageConfig[K]
  ) {
    setConfig(prev => ({ ...prev, [name]: value }));
    setNotice('');
  }
  function updatePlan(index: number,
    name: keyof SalesPageConfig['plans'][number], value: unknown
  ) {
    setConfig(prev => ({
      ...prev,
      plans: prev.plans.map((plan, i) =>
        i === index ? { ...plan, [name]: value } : plan)
    }));
    setNotice('');
  }
  function updateFaq(index: number, name: 'question' | 'answer', value: string) {
    setConfig(prev => ({
      ...prev, faq: prev.faq.map((item, i) =>
        i === index ? { ...item, [name]: value } : item)
    }));
  }
  function addPlan() {
    if (config.plans.length >= 4) return;
    setConfig(prev => ({
      ...prev, plans: [...prev.plans, {
        id: 'plano-' + Date.now().toString(36),
        name: 'Novo plano', description: '',
        price: 'Sob consulta', frequency: '',
        highlights: ['Descreva uma vantagem do plano'],
        featured: false, checkout_url: ''
      }]
    }));
  }
  function addFaq() {
    if (config.faq.length >= 8) return;
    update('faq', [...config.faq, {
      question: 'Qual é a sua dúvida?',
      answer: 'Escreva uma resposta para os visitantes.'
    }]);
  }

  async function save(event: FormEvent<HTMLFormElement>, makePublic: boolean) {
    event.preventDefault();
    setError(''); setNotice('');
    const validated = salesPageSchema.safeParse(config);
    if (!validated.success) {
      setError('Confira os campos. ' + validated.error.issues[0]?.message);
      return;
    }
    if (makePublic && !config.whatsapp &&
      !config.plans.some(plan => plan.checkout_url)) {
      setError('Para publicar, informe seu WhatsApp ou um link HTTPS de compra.');
      return;
    }
    if (!ensureHttps(config.logo_url) ||
      config.plans.some(plan => !ensureHttps(plan.checkout_url))) {
      setError('Links de imagem e compra devem usar HTTPS.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/platform/sales-page', {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          config: validated.data,
          published: makePublic,
          expected_revision: revision
        })
      });
      const result = await response.json().catch(() => null) as
        { success?: boolean; revision?: number; error?: { message?: string } } | null;
      if (!response.ok || !result?.success || typeof result.revision !== 'number') {
        throw new Error(result?.error?.message ||
          (response.status === 409
            ? 'Outra edição foi salva. Recarregue a página antes de continuar.'
            : 'Não foi possível salvar. Nenhuma alteração foi confirmada.'));
      }
      setRevision(result.revision);
      setPublished(makePublic);
      setNotice(makePublic
        ? 'Página de vendas publicada! O conteúdo foi atualizado no servidor.'
        : 'Rascunho salvo. O conteúdo público não foi publicado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally { setBusy(false); }
  }

  const waLink = whatsappUrl(config.whatsapp, config.whatsapp_message);
  const panelDisabled = loading || busy;

  return <div className="sales-editor">
    <div className="sales-editor-back">
      <Link to="/superadmin"><ArrowLeft size={17}/> Voltar ao painel</Link>
      <a href="/vendas" target="_blank" rel="noopener noreferrer">
        <ExternalLink size={17}/> Ver página pública
      </a>
    </div>
    <div className="sales-editor-top">
      <div>
        <p className="sales-editor-eyebrow">CR JORNADA · SUPERADMIN</p>
        <h2>Configurar página de vendas</h2>
        <p>Edite textos, benefícios, planos e seus canais de contato. Publique as mudanças sem alterar o código.</p>
      </div>
      <span className={'sales-editor-state '+(published?'is-live':'')}>
        {published ? <><Eye size={16}/> Publicada</> : <><EyeOff size={16}/> Não publicada</>}
      </span>
    </div>
    {loading && <div className="sales-editor-info" role="status">Carregando configurações…</div>}
    {error && <div className="sales-editor-error" role="alert">{error}</div>}
    {notice && <div className="sales-editor-success" role="status">
      <CheckCircle2 size={18}/>{notice}
    </div>}
    {!loading && <form onSubmit={event => save(event, false)}>
      <section className="sales-editor-section">
        <div className="sales-editor-section-title"><span>01</span><div>
          <h3>Apresentação da página</h3>
          <p>Esses textos aparecem na primeira seção e nas buscas da internet.</p>
        </div></div>
        <div className="sales-editor-fields">
          <label>Etiqueta acima do título
            <input value={config.eyebrow} maxLength={55} required disabled={panelDisabled}
              onChange={e => update('eyebrow', e.target.value)}/>
          </label>
          <label>Título principal
            <textarea rows={2} value={config.headline} maxLength={115} required disabled={panelDisabled}
              onChange={e => update('headline', e.target.value)}/>
          </label>
          <label>Descrição de destaque
            <textarea rows={3} value={config.subtitle} maxLength={360} required disabled={panelDisabled}
              onChange={e => update('subtitle', e.target.value)}/>
          </label>
          <label>Descrição para mecanismos de busca
            <textarea rows={2} value={config.description} maxLength={170} required disabled={panelDisabled}
              onChange={e => update('description', e.target.value)}/>
          </label>
          <div className="sales-editor-cols">
            <label>Cor principal
              <div className="sales-editor-color">
                <input type="color" value={config.primary_color} disabled={panelDisabled}
                  onChange={e => update('primary_color', e.target.value)}/>
                <span>{config.primary_color}</span>
              </div>
            </label>
            <label>URL da logomarca (opcional)
              <input type="url" placeholder="https://exemplo.com/logo.png"
                value={config.logo_url} disabled={panelDisabled}
                onChange={e => update('logo_url', e.target.value)}/>
            </label>
          </div>
        </div>
      </section>

      <section className="sales-editor-section">
        <div className="sales-editor-section-title"><span>02</span><div>
          <h3>Contato comercial</h3>
          <p>Configure seu próprio WhatsApp para receber dúvidas e propostas.</p>
        </div></div>
        <div className="sales-editor-fields">
          <div className="sales-editor-cols">
            <label>WhatsApp com código do Brasil (55 + DDD + número)
              <input type="tel" inputMode="numeric"
                value={config.whatsapp} maxLength={13}
                placeholder="5573999999999" disabled={panelDisabled}
                onChange={e => update('whatsapp', e.target.value.replace(/\D/g, ''))}/>
              <small>Somente números. Nenhum telefone é divulgado antes de você preencher e publicar.</small>
            </label>
            <label>E-mail comercial (opcional)
              <input type="email" placeholder="contato@exemplo.com"
                value={config.contact_email} disabled={panelDisabled}
                onChange={e => update('contact_email', e.target.value)}/>
            </label>
          </div>
          <label>Mensagem pronta que o cliente enviará no WhatsApp
            <textarea rows={2} maxLength={250} value={config.whatsapp_message}
              disabled={panelDisabled}
              onChange={e => update('whatsapp_message', e.target.value)}/>
          </label>
          {waLink && <a className="sales-editor-preview-link"
            target="_blank" rel="noopener noreferrer" href={waLink}>
            <MessageCircle size={17}/> Testar abertura do seu WhatsApp
          </a>}
        </div>
      </section>

      <section className="sales-editor-section">
        <div className="sales-editor-section-title"><span>03</span><div>
          <h3>Benefícios do sistema</h3>
          <p>Uma vantagem por linha. Entre 3 e 6 vantagens.</p>
        </div></div>
        <label className="sales-editor-fields">Benefícios
          <textarea rows={6} value={textLines(config.benefits)} disabled={panelDisabled}
            onChange={e => update('benefits', fromLines(e.target.value))}/>
        </label>
      </section>

      <section className="sales-editor-section">
        <div className="sales-editor-section-title"><span>04</span><div>
          <h3>Planos e condições</h3>
          <p>Cadastre até 4 planos. O link de compra é opcional e deve vir de um checkout externo confiável.</p>
        </div></div>
        <div className="sales-editor-plans">
          {config.plans.map((plan, index) => <article key={plan.id}>
            <header><strong>Plano {index+1}</strong>
              {config.plans.length>1 && <button type="button" disabled={panelDisabled}
                onClick={() => update('plans', config.plans.filter(p => p.id!==plan.id))}>
                <Trash2 size={15}/> Excluir
              </button>}
            </header>
            <label>Nome do plano
              <input value={plan.name} required maxLength={65} disabled={panelDisabled}
                onChange={e => updatePlan(index,'name',e.target.value)}/>
            </label>
            <label>Descrição
              <input value={plan.description} maxLength={180} disabled={panelDisabled}
                onChange={e => updatePlan(index,'description',e.target.value)}/>
            </label>
            <div className="sales-editor-cols">
              <label>Preço ou condição
                <input value={plan.price} maxLength={45} required disabled={panelDisabled}
                  placeholder="Ex.: R$ 99,90 ou Sob consulta"
                  onChange={e => updatePlan(index,'price',e.target.value)}/>
              </label>
              <label>Período (opcional)
                <input value={plan.frequency} maxLength={35} disabled={panelDisabled}
                  placeholder="Ex.: por mês"
                  onChange={e => updatePlan(index,'frequency',e.target.value)}/>
              </label>
            </div>
            <label>O que está incluído (uma linha por item)
              <textarea rows={4} value={textLines(plan.highlights)} disabled={panelDisabled}
                onChange={e => updatePlan(index,'highlights',fromLines(e.target.value))}/>
            </label>
            <label>Link externo de compra (opcional)
              <input type="url" value={plan.checkout_url} disabled={panelDisabled}
                placeholder="https://checkout.exemplo.com/seu-plano"
                onChange={e => updatePlan(index,'checkout_url',e.target.value)}/>
            </label>
            <label className="sales-editor-check">
              <input type="checkbox" checked={plan.featured} disabled={panelDisabled}
                onChange={e => updatePlan(index,'featured',e.target.checked)}/>
              Destacar este plano na página
            </label>
          </article>)}
        </div>
        {config.plans.length<4 && <button className="sales-editor-add" type="button"
          disabled={panelDisabled} onClick={addPlan}><Plus size={18}/> Adicionar plano</button>}
      </section>

      <section className="sales-editor-section">
        <div className="sales-editor-section-title"><span>05</span><div>
          <h3>Perguntas frequentes</h3>
          <p>Ajude o cliente a esclarecer as principais dúvidas antes de entrar em contato.</p>
        </div></div>
        {config.faq.map((item,index)=><div className="sales-editor-faq-item" key={index}>
          <div className="sales-editor-faq-head"><strong>Pergunta {index+1}</strong>
            <button type="button" disabled={panelDisabled}
              onClick={()=>update('faq',config.faq.filter((_,i)=>i!==index))}>
              <Trash2 size={15}/> Remover
            </button>
          </div>
          <label>Pergunta
            <input value={item.question} maxLength={150} disabled={panelDisabled}
              onChange={e=>updateFaq(index,'question',e.target.value)}/>
          </label>
          <label>Resposta
            <textarea rows={3} value={item.answer} maxLength={500}
              disabled={panelDisabled} onChange={e=>updateFaq(index,'answer',e.target.value)}/>
          </label>
        </div>)}
        {config.faq.length<8 && <button className="sales-editor-add" type="button"
          disabled={panelDisabled} onClick={addFaq}><Plus size={18}/> Adicionar pergunta</button>}
        <div className="sales-editor-fields">
          <label>Informação no rodapé da página
            <textarea rows={2} maxLength={200} value={config.footer_note}
              disabled={panelDisabled}
              onChange={e=>update('footer_note',e.target.value)}/>
          </label>
        </div>
      </section>

      <section className="sales-editor-publish">
        <div><ShieldCheck size={23}/>
          <div><h3>Revisar e publicar</h3>
            <p>Ao clicar em <strong>Salvar e publicar</strong>, a página pública buscará a versão nova no D1 automaticamente, sem novo deploy. Para retirar do ar, use <strong>Salvar como rascunho</strong>.</p>
          </div>
        </div>
        <div className="sales-editor-publish-actions">
          <button disabled={panelDisabled} type="submit" className="sales-editor-draft">
            <Save size={17}/>{busy?'Salvando…':'Salvar como rascunho'}
          </button>
          <button disabled={panelDisabled} type="button" className="sales-editor-live"
            onClick={event => {
              const form = event.currentTarget.closest('form');
              if (form && !form.reportValidity()) return;
              void save(event as unknown as FormEvent<HTMLFormElement>, true);
            }}><CheckCircle2 size={17}/>{busy?'Publicando…':'Salvar e publicar'}</button>
        </div>
      </section>
    </form>}
  </div>;
}
