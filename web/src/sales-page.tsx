import { useEffect, useState } from 'react';
import {
  ArrowRight, BadgeCheck, Building2, Check, CheckCircle2,
  Clock3, HelpCircle, Mail, MessageCircle, ShieldCheck, Sparkles,
  CalendarDays, FileBarChart2, Fingerprint, LockKeyhole, MonitorSmartphone,
  UsersRound, ClipboardList, CircleDot
} from 'lucide-react';
import {
  defaultSalesPage, salesPageSchema, whatsappUrl,
  type SalesPageConfig
} from '../../shared/sales-page';
import { SalesLeadForm } from './sales-lead-form';
import './sales-page.css';

type PageState = 'loading' | 'live' | 'preview' | 'unpublished' | 'unavailable';
type PublicResponse = {
  published: boolean;
  config: SalesPageConfig | null;
  leads_available?: boolean;
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

export function isSalesPreviewHost(hostname: string) {
  return hostname.endsWith('.pages.dev') ||
    hostname === 'localhost' || hostname === '127.0.0.1';
}

function getWhatsApp(config: SalesPageConfig) {
  return whatsappUrl(config.whatsapp, config.whatsapp_message);
}

export function SalesPage() {
  const [status, setStatus] = useState<PageState>('loading');
  const [config, setConfig] = useState<SalesPageConfig>(defaultSalesPage);
  const [error, setError] = useState('');
  const [leadsAvailable, setLeadsAvailable] = useState(false);

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
      setLeadsAvailable(payload.leads_available === true);
      setStatus('live');
    }).catch(err => {
      if (!active) return;
      // Cloudflare Pages so publica os arquivos estaticos: demonstracao
      // claramente rotulada, sem CTA de compra nem contato ficticio.
      const previewHost = isSalesPreviewHost(window.location.hostname);
      setError(err instanceof Error ? err.message : 'Prévia sem servidor.');
      // Nao exibir ofertas ficticias quando o backend da loja oficial falhar.
      setStatus(previewHost ? 'preview' : 'unavailable');
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

  if (status === 'unavailable') return <main className="sales-pending">
    <div className="sales-brand"><Clock3 size={26}/> CR JORNADA</div>
    <h1>Página temporariamente indisponível.</h1>
    <p>Estamos trabalhando para restabelecer o acesso. Tente novamente mais tarde.</p>
  </main>;

  if (status === 'unpublished') return <main className="sales-pending">
    <div className="sales-brand"><Clock3 size={26}/> CR JORNADA</div>
    <h1>Estamos preparando uma novidade.</h1>
    <p>Nossa página comercial ainda não está disponível. Volte em breve.</p>
  </main>;

  if (!publicConfig) return null;
  return <SalesPageView config={publicConfig} status={status} error={error}
    leadsAvailable={leadsAvailable}/>;
}

export function SalesPageView({
  config, status, error = '', leadsAvailable = false
}: {
  config: SalesPageConfig;
  status: 'live' | 'preview' | 'editing';
  error?: string;
  leadsAvailable?: boolean;
}) {
  const waLink = status === 'live' ? getWhatsApp(config) : null;
  const features = config.features ?? defaultSalesPage.features ?? [];
  const steps = config.steps ?? defaultSalesPage.steps ?? [];
  const featureIcons = [
    Fingerprint, CalendarDays, MonitorSmartphone,
    UsersRound, FileBarChart2, LockKeyhole
  ];
  const stages = {
    planned: 'Planejado',
    testing: 'Em validação',
    available: 'Disponível'
  } as const;

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
        <a href="#recursos">Recursos</a>
        <a href="#beneficios">Vantagens</a>
        <a href="#como-funciona">Como funciona</a>
        <a href="#planos">Planos</a>
      </nav>
      <a className="sales-header-cta" href={waLink || (config.lead_form_enabled ? '#interesse' : '#planos')}>
        {waLink ? 'Tirar dúvidas' : 'Saiba mais'} <ArrowRight size={15}/>
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
            <a href="#recursos" className="sales-button sales-button-primary">
              Conhecer os recursos <ArrowRight size={19}/>
            </a>
            <a href="#planos" className="sales-button sales-button-outline">
              Ver planos e condições <ArrowRight size={18}/>
            </a>
            {waLink && <a className="sales-button sales-button-outline"
              href={waLink} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={18}/> Tirar dúvidas
            </a>}
          </div>
          <div className="sales-hero-note">
            <ShieldCheck size={16}/> Recursos em desenvolvimento e validação; disponibilidade informada antes da contratação.
          </div>
        </div>
        <div className="sales-hero-visual" aria-label="Prévia conceitual do painel de jornadas">
          <div className="sales-visual-top">
            <div className="sales-brand-mark"><Clock3 size={20}/></div>
            <div><strong>Sua rotina em perspectiva</strong><small>Representação conceitual</small></div>
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

    <section id="recursos" className="sales-section sales-resources">
      <div className="sales-section-head">
        <span className="sales-overline">CONHEÇA A PROPOSTA</span>
        <h2>Entenda o que o CR JORNADA foi pensado para organizar.</h2>
        <p>Da equipe aos horários, conheça cada módulo com explicações claras e acompanhe o estágio de desenvolvimento.</p>
      </div>
      <div className="sales-resource-grid">
        {features.map((feature, i) => {
          const Icon = featureIcons[i % featureIcons.length];
          return <article className="sales-resource-card" key={i}>
            <div className="sales-resource-top">
              <span className="sales-resource-icon"><Icon size={23}/></span>
              <span className={'sales-resource-stage sales-resource-stage-' + feature.stage}>
                <CircleDot size={12}/>{stages[feature.stage]}
              </span>
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>;
        })}
      </div>
      <p className="sales-resource-disclaimer">
        <ShieldCheck size={17}/>
        Os estágios acima descrevem a evolução dos módulos. A ativação de cada função depende da conclusão dos testes e das condições do plano.
      </p>
    </section>

    <section id="beneficios" className="sales-benefits-band">
      <div className="sales-benefits-inner">
        <div className="sales-benefits-intro">
          <span className="sales-overline">POR QUE ORGANIZAR A JORNADA?</span>
          <h2>Uma rotina mais clara para quem gerencia e para quem trabalha.</h2>
          <p>O CR JORNADA está sendo construído para reunir informações em um só lugar e facilitar o entendimento da rotina de cada empresa.</p>
          <a href="#como-funciona">Veja as etapas da implantação <ArrowRight size={17}/></a>
        </div>
        <div className="sales-benefits-list">
          {config.benefits.map((benefit, i) => <div key={i}>
            <span><CheckCircle2 size={21}/></span>
            <strong>{benefit}</strong>
          </div>)}
        </div>
      </div>
    </section>

    <section id="como-funciona" className="sales-section sales-how">
      <div className="sales-section-head">
        <span className="sales-overline">DO PRIMEIRO CONTATO À ROTINA</span>
        <h2>Como funciona a jornada de implantação.</h2>
        <p>Entenda as etapas previstas para preparar o sistema para sua empresa, sem surpresas durante a contratação.</p>
      </div>
      <div className="sales-steps-grid">
        {steps.map((step, i) => <article key={i} className="sales-step">
          <span className="sales-step-number">{String(i+1).padStart(2, '0')}</span>
          <div className="sales-step-body">
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </div>
        </article>)}
      </div>
      <div className="sales-how-note">
        <ClipboardList size={20}/>
        <p><strong>Implantação responsável:</strong> o início dos registros reais depende da ativação do ambiente, da conferência dos cadastros e da validação da operação.</p>
      </div>
    </section>

    <section id="planos" className="sales-section sales-pricing">
      <div className="sales-section-head">
        <span className="sales-overline">ESCOLHA O CAMINHO CERTO</span>
        <h2>Conheça os planos e compare as opções.</h2>
        <p>Veja o que cada plano propõe. Preços, recursos liberados e condições de contratação serão confirmados antes da assinatura.</p>
      </div>
      <p className="sales-plan-advice"><BadgeCheck size={17}/>
        Consulte a disponibilidade efetiva dos módulos descritos em cada plano. A demonstração não representa uma contratação ativa.
      </p>
      <div className="sales-plan-grid">
        {config.plans.map(plan => {
          const checkout = status === 'live' ? plan.checkout_url : '';
          const action = checkout || waLink ||
            (status === 'live' && config.lead_form_enabled ? '#interesse' : null);
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
                  href={action} target={action.startsWith('#') ? undefined : '_blank'}
                  rel={action.startsWith('#') ? undefined : 'noopener noreferrer'}>
                  {checkout ? 'Ver condições de compra' :
                    action.startsWith('#') ? 'Solicitar informações' : 'Consultar este plano'}
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
        <h2>Tudo explicado para você decidir com segurança.</h2>
      </div>
      <div className="sales-faq-list">
        {config.faq.map((item,i) => <details key={i}>
          <summary><HelpCircle size={19}/>{item.question}<span>+</span></summary>
          <p>{item.answer}</p>
        </details>)}
      </div>
    </section>

    {(config.lead_form_enabled || status === 'preview') &&
      <section id="interesse" className="sales-section sales-lead-section">
        <div className="sales-section-head">
          <span className="sales-overline">INFORMAÇÕES E PROPOSTAS</span>
          <h2>Quer entender se o CR JORNADA atende sua empresa?</h2>
          <p>Conte um pouco sobre sua necessidade. Não é necessário ter WhatsApp para pedir informações.</p>
        </div>
        <div className="sales-lead-container">
          <SalesLeadForm config={config}
            enabled={status === 'live' && config.lead_form_enabled === true &&
              leadsAvailable}/>
        </div>
      </section>}

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
          {status === 'live' && config.contact_email && <a className="sales-button sales-button-translucent"
            href={'mailto:' + config.contact_email}>
            <Mail size={17}/> {config.contact_email}
          </a>}
          {!waLink && (status !== 'live' || !config.contact_email) &&
            <p>{config.lead_form_enabled
              ? 'Você também pode enviar uma solicitação pelo formulário desta página.'
              : 'Os canais de contato serão exibidos quando forem configurados pelo Superadmin.'}</p>}
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
