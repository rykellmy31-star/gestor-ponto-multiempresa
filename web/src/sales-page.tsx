import { useEffect, useState } from 'react';
import {
  ArrowRight, BadgeCheck, Building2, Check, CheckCircle2,
  Clock3, HelpCircle, Mail, MessageCircle, ShieldCheck, Sparkles
} from 'lucide-react';
import {
  defaultSalesPage, salesPageSchema, whatsappUrl,
  type SalesPageConfig
} from '../../shared/sales-page';
import './sales-page.css';

type PageState = 'loading' | 'live' | 'preview' | 'unpublished';
type PublicResponse = {
  published: boolean;
  config: SalesPageConfig | null;
};

function setMeta(name: string, content: string, attribute = 'name') {
  let meta = document.head.querySelector<HTMLMetaElement>(
    'meta[' + attribute + '="' + name + '"]'
  );
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, name);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

function getWhatsApp(config: SalesPageConfig) {
  return whatsappUrl(config.whatsapp, config.whatsapp_message);
}

export function SalesPage() {
  const [status, setStatus] = useState<PageState>('loading');
  const [config, setConfig] = useState<SalesPageConfig>(defaultSalesPage);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch('/api/public/sales-page', {
      signal: controller.signal, cache: 'no-store'
    }).then(async response => {
      if (!response.ok) throw new Error('Servidor comercial indisponível.');
      const payload = await response.json() as PublicResponse;
      if (!active) return;
      if (!payload.published || !payload.config) {
        setStatus('unpublished');
        return;
      }
      const parsed = salesPageSchema.safeParse(payload.config);
      if (!parsed.success) throw new Error('Configuração inválida.');
      setConfig(parsed.data);
      setStatus('live');
    }).catch(err => {
      if (!active) return;
      // Cloudflare Pages so publica os arquivos estaticos: demonstracao
      // claramente rotulada, sem CTA de compra nem contato ficticio.
      setError(err instanceof Error ? err.message : 'Prévia sem servidor.');
      setStatus('preview');
    });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    document.title = 'CR JORNADA — Gestão de ponto para empresas | Planos';
    setMeta('description', config.description);
    setMeta('og:title', 'CR JORNADA | ' + config.headline, 'property');
    setMeta('og:description', config.description, 'property');
    setMeta('og:type', 'website', 'property');
    // Evita indexacao de paginas de teste e de conteudo nao publicado.
    setMeta('robots', status === 'live' ? 'index, follow' : 'noindex, nofollow');
    return () => {
      document.title = 'CR JORNADA · Gestão de ponto';
      setMeta('robots', 'noindex, nofollow');
    };
  }, [status, config]);

  const publicConfig = status === 'live' || status === 'preview' ? config : null;

  if (status === 'loading') return <main className="sales-pending" role="status">
    <Clock3 size={34}/> Preparando a página do CR JORNADA…
  </main>;

  if (status === 'unpublished') return <main className="sales-pending">
    <div className="sales-brand"><Clock3 size={26}/> CR JORNADA</div>
    <h1>Estamos preparando uma novidade.</h1>
    <p>Nossa página comercial ainda não está disponível. Volte em breve.</p>
  </main>;

  if (!publicConfig) return null;
  return <SalesPageView config={publicConfig} status={status} error={error}/>;
}

export function SalesPageView({
  config, status, error = ''
}: {
  config: SalesPageConfig;
  status: 'live' | 'preview' | 'editing';
  error?: string;
}) {
  const waLink = status === 'live' ? getWhatsApp(config) : null;

  return <main className="sales-root" style={{
    '--sales-brand': config.primary_color
  } as React.CSSProperties}>
    {status !== 'live' && <div className="sales-preview-banner" role="status">
      <Sparkles size={17}/>
      {status === 'editing'
        ? 'PRÉVIA PRIVADA — alterações não publicadas e botões de contratação desativados.'
        : 'PRÉVIA VISUAL — dados de exemplo. A publicação automática exige o backend oficial do CR JORNADA.'}
      {status === 'preview' && <span className="sales-preview-reason">({error})</span>}
    </div>}

    <header className="sales-header">
      <a href="#inicio" className="sales-brand">
        {config.logo_url
          ? <img alt="Logomarca do CR JORNADA" src={config.logo_url}/>
          : <span className="sales-brand-mark"><Clock3 size={22}/></span>}
        <strong>CR JORNADA</strong>
      </a>
      <nav aria-label="Menu comercial">
        <a href="#beneficios">Benefícios</a>
        <a href="#planos">Planos</a>
        <a href="#duvidas">Dúvidas</a>
      </nav>
      <a className="sales-header-cta" href={waLink || '#contato'}>
        {waLink ? 'Falar no WhatsApp' : 'Contato'} <ArrowRight size={15}/>
      </a>
    </header>

    <section id="inicio" className="sales-hero">
      <div className="sales-hero-background" aria-hidden="true"/>
      <div className="sales-hero-inner">
        <div className="sales-hero-copy">
          <span className="sales-eyebrow"><Sparkles size={15}/>{config.eyebrow}</span>
          <h1>{config.headline}</h1>
          <p>{config.subtitle}</p>
          <div className="sales-hero-actions">
            <a href="#planos" className="sales-button sales-button-primary">
              Conhecer os planos <ArrowRight size={19}/>
            </a>
            {waLink && <a className="sales-button sales-button-outline"
              href={waLink} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18}/> Tirar dúvidas
            </a>}
          </div>
          <div className="sales-hero-note">
            <ShieldCheck size={16}/> Planeje a gestão da jornada com mais organização.
          </div>
        </div>
        <div className="sales-hero-visual" aria-label="Prévia conceitual do painel de jornadas">
          <div className="sales-visual-top">
            <div className="sales-brand-mark"><Clock3 size={20}/></div>
            <div><strong>Visão da operação</strong><small>Painel ilustrativo</small></div>
            <span className="sales-visual-live">CR JORNADA</span>
          </div>
          <div className="sales-visual-grid">
            <div><Building2 size={21}/><span>Empresas</span><strong>Gestão</strong></div>
            <div><Clock3 size={21}/><span>Jornadas</span><strong>Controle</strong></div>
            <div><BadgeCheck size={21}/><span>Equipe</span><strong>Organização</strong></div>
          </div>
          <div className="sales-visual-lines">
            <strong>Acompanhamento de horários</strong>
            <div><span>Entrada</span><b className="sales-bar sales-bar-one"/></div>
            <div><span>Intervalo</span><b className="sales-bar sales-bar-two"/></div>
            <div><span>Saída</span><b className="sales-bar sales-bar-three"/></div>
          </div>
          <p>Ilustração demonstrativa, sem dados de funcionários reais.</p>
        </div>
      </div>
    </section>

    <section id="beneficios" className="sales-section sales-benefits">
      <div className="sales-section-head">
        <span className="sales-overline">UM NOVO JEITO DE ORGANIZAR</span>
        <h2>Mais clareza para quem administra. Mais praticidade para quem trabalha.</h2>
        <p>Uma experiência projetada para acompanhar a rotina das empresas.</p>
      </div>
      <div className="sales-benefit-grid">
        {config.benefits.map((benefit, i) => <article key={i} className="sales-benefit">
          <div className="sales-benefit-icon"><CheckCircle2 size={23}/></div>
          <h3>{benefit}</h3>
          <p>Conheça como o CR JORNADA pode apoiar essa necessidade.</p>
        </article>)}
      </div>
    </section>

    <section id="planos" className="sales-section sales-pricing">
      <div className="sales-section-head">
        <span className="sales-overline">ESCOLHA O CAMINHO CERTO</span>
        <h2>Planos pensados para diferentes necessidades.</h2>
        <p>Converse conosco para verificar condições e disponibilidade antes de contratar.</p>
      </div>
      <div className="sales-plan-grid">
        {config.plans.map(plan => {
          const checkout = status === 'live' ? plan.checkout_url : '';
          const action = checkout || waLink;
          return <article key={plan.id} className={'sales-plan '+(plan.featured ? 'sales-plan-featured' : '')}>
            {plan.featured && <span className="sales-plan-badge"><Sparkles size={13}/> EM DESTAQUE</span>}
            <h3>{plan.name}</h3>
            <p className="sales-plan-desc">{plan.description}</p>
            <div className="sales-plan-price">{plan.price}<small>{plan.frequency}</small></div>
            <div className="sales-plan-divider"/>
            <ul>{plan.highlights.map((feature,i) =>
              <li key={i}><Check size={17}/>{feature}</li>)}
            </ul>
            {action
              ? <a className={'sales-button '+(plan.featured ? 'sales-button-primary' : 'sales-button-outline')}
                  href={action} target="_blank" rel="noopener noreferrer">
                  {checkout ? 'Ver condições de compra' : 'Consultar este plano'}
                  <ArrowRight size={17}/>
                </a>
              : <span className="sales-plan-unavailable">
                  {status !== 'live' ? 'Disponível após a publicação' : 'Contato comercial em configuração'}
                </span>}
          </article>;
        })}
      </div>
    </section>

    <section id="duvidas" className="sales-section sales-faq">
      <div className="sales-section-head">
        <span className="sales-overline">PERGUNTAS FREQUENTES</span>
        <h2>Tire suas dúvidas antes de começar.</h2>
      </div>
      <div className="sales-faq-list">
        {config.faq.map((item,i) => <details key={i}>
          <summary><HelpCircle size={19}/>{item.question}<span>+</span></summary>
          <p>{item.answer}</p>
        </details>)}
      </div>
    </section>

    <section id="contato" className="sales-contact-wrap">
      <div className="sales-contact">
        <div>
          <span className="sales-overline">ESTAMOS AQUI PARA CONVERSAR</span>
          <h2>Vamos encontrar o melhor caminho para sua empresa?</h2>
          <p>Fale diretamente com o responsável pelo CR JORNADA e esclareça suas dúvidas.</p>
        </div>
        <div className="sales-contact-actions">
          {waLink && <a className="sales-button sales-button-white"
            href={waLink} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={19}/> Conversar pelo WhatsApp
          </a>}
          {config.contact_email && <a className="sales-button sales-button-translucent"
            href={'mailto:' + config.contact_email}>
            <Mail size={17}/> {config.contact_email}
          </a>}
          {!waLink && !config.contact_email &&
            <p>Os canais de contato serão exibidos quando forem configurados pelo Superadmin.</p>}
        </div>
      </div>
    </section>

    <footer className="sales-footer">
      <div className="sales-brand"><Clock3 size={23}/> CR JORNADA</div>
      <p>{config.footer_note}</p>
      <span>© {new Date().getFullYear()} CR JORNADA. Página comercial.</span>
    </footer>
  </main>;
}
