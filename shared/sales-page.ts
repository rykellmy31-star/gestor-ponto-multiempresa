import { z } from 'zod';

const httpsLink = z.union([
  z.literal(''),
  z.string().trim().url().max(2048).refine(value => value.startsWith('https://'))
]);

const salesPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(50),
  name: z.string().trim().min(2).max(65),
  description: z.string().trim().max(180),
  price: z.string().trim().min(2).max(45),
  frequency: z.string().trim().max(35),
  highlights: z.array(z.string().trim().min(3).max(120)).min(1).max(9),
  featured: z.boolean(),
  checkout_url: httpsLink
}).strict();

// Campos opcionais preservam configuracoes comerciais antigas no D1.
// Ao abrir o editor, o Superadmin recebe sugestoes de texto editaveis.
export const salesFeatureSchema = z.object({
  title: z.string().trim().min(4).max(85),
  description: z.string().trim().min(24).max(360),
  stage: z.enum(['planned', 'testing', 'available'])
}).strict();

export const salesStepSchema = z.object({
  title: z.string().trim().min(5).max(85),
  description: z.string().trim().min(24).max(300)
}).strict();

export const salesPageSchema = z.object({
  eyebrow: z.string().trim().min(3).max(55),
  headline: z.string().trim().min(8).max(115),
  subtitle: z.string().trim().min(15).max(360),
  description: z.string().trim().min(12).max(170),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  whatsapp: z.union([z.literal(''), z.string().regex(/^55[0-9]{10,11}$/)]),
  whatsapp_message: z.string().trim().min(5).max(250),
  contact_email: z.union([z.literal(''), z.email().max(254)]),
  logo_url: httpsLink,
  benefits: z.array(z.string().trim().min(3).max(125)).min(3).max(6),
  features: z.array(salesFeatureSchema).min(3).max(6).optional(),
  steps: z.array(salesStepSchema).min(3).max(5).optional(),
  plans: z.array(salesPlanSchema).min(1).max(4),
  faq: z.array(z.object({
    question: z.string().trim().min(6).max(150),
    answer: z.string().trim().min(10).max(500)
  }).strict()).max(8),
  footer_note: z.string().trim().max(200)
}).strict().superRefine((page, ctx) => {
  const ids = page.plans.map(plan => plan.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Os identificadores dos planos devem ser diferentes.',
      path: ['plans']
    });
  }
});

export type SalesPageConfig = z.infer<typeof salesPageSchema>;

export const defaultSalesPage: SalesPageConfig = {
  eyebrow: 'GESTÃO DE PONTO MULTIEMPRESA',
  headline: 'A gestão de jornada que acompanha o crescimento da sua empresa.',
  subtitle: 'Centralize a administração de funcionários, jornadas e registros em uma experiência organizada e intuitiva.',
  description: 'Conheça o CR JORNADA, uma plataforma de gestão de jornada para empresas.',
  primary_color: '#800000',
  whatsapp: '',
  whatsapp_message: 'Olá! Gostaria de saber mais sobre o CR JORNADA.',
  contact_email: '',
  logo_url: '',
  benefits: [
    'Mais organização para a rotina do RH',
    'Cada empresa com seus próprios dados e acessos',
    'Funcionários acompanhando os próprios registros',
    'Escalas, períodos e acompanhamento em um só lugar'
  ],
  features: [
    {
      title: 'Registros de entrada, intervalo e saída',
      description: 'O projeto contempla o registro da jornada por funcionário e a consulta do histórico mensal. O fluxo de marcação efetiva está em testes antes da liberação para empresas.',
      stage: 'testing'
    },
    {
      title: 'Gestão de escalas e horários',
      description: 'Planeje os horários de trabalho, organize as escalas e associe cada jornada à empresa correta. A administração de jornadas por empresa está em homologação.',
      stage: 'testing'
    },
    {
      title: 'Área individual do funcionário',
      description: 'Cada colaborador terá um acesso próprio para identificar sua empresa, consultar o histórico da jornada e acompanhar seus dados, respeitando as permissões.',
      stage: 'testing'
    },
    {
      title: 'Painel administrativo da empresa',
      description: 'Centralize cadastros de funcionários, visualize a equipe e organize as informações da operação em um painel específico para sua empresa.',
      stage: 'planned'
    },
    {
      title: 'Relatórios e acompanhamento de horas',
      description: 'A proposta inclui ferramentas para acompanhar jornadas, saldos e ocorrências em períodos definidos, conforme a implantação e a validação dos cálculos.',
      stage: 'planned'
    },
    {
      title: 'Separação de dados entre empresas',
      description: 'O CR JORNADA está sendo estruturado para manter funcionários, sessões e registros vinculados à organização correspondente, com controles de acesso testados no banco.',
      stage: 'testing'
    }
  ],
  steps: [
    {
      title: 'Conheça os recursos',
      description: 'Explore as possibilidades da plataforma e entenda quais funções atendem à rotina da sua equipe.'
    },
    {
      title: 'Planeje a configuração',
      description: 'Defina com a equipe responsável os cadastros, horários, permissões e necessidades da sua empresa.'
    },
    {
      title: 'Prepare funcionários e escalas',
      description: 'Na implantação, cadastre a equipe e configure os horários adequados à operação, depois da liberação dos módulos.'
    },
    {
      title: 'Acompanhe a jornada',
      description: 'Após a ativação e os testes do seu ambiente, gestores e funcionários poderão consultar os registros e acompanhar o trabalho.'
    }
  ],
  plans: [
    {
      id: 'essencial', name: 'Essencial',
      description: 'Para começar a organizar a jornada da equipe.',
      price: 'Sob consulta', frequency: '',
      highlights: ['Painel para acompanhar a equipe', 'Gestão de funcionários e jornadas',
        'Suporte para conhecer a plataforma'],
      featured: false, checkout_url: ''
    },
    {
      id: 'profissional', name: 'Profissional',
      description: 'Para empresas que desejam ampliar a gestão.',
      price: 'Sob consulta', frequency: '',
      highlights: ['Recursos de acompanhamento da jornada',
        'Configurações para a rotina da empresa', 'Atendimento para avaliar suas necessidades'],
      featured: true, checkout_url: ''
    },
    {
      id: 'empresarial', name: 'Empresarial',
      description: 'Para organizações com necessidades específicas.',
      price: 'Sob consulta', frequency: '',
      highlights: ['Avaliação de necessidades da operação',
        'Planejamento de implantação', 'Proposta personalizada'],
      featured: false, checkout_url: ''
    }
  ],
  faq: [
    { question: 'Como conhecer o CR JORNADA?',
      answer: 'Entre em contato para conversar sobre sua empresa e receber informações da plataforma.' },
    { question: 'Como são definidos os valores?',
      answer: 'Os valores e condições dependem do plano e serão apresentados antes da contratação.' },
    { question: 'Como funciona a contratação?',
      answer: 'Converse com a equipe comercial para conhecer as condições e a disponibilidade do serviço.' }
  ],
  footer_note: 'Funcionalidades e disponibilidade estão sujeitas ao plano contratado.'
};

export function whatsappUrl(phone: string, message: string): string | null {
  if (!/^55[0-9]{10,11}$/.test(phone)) return null;
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);
}
