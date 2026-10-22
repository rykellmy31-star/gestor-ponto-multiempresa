import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultSalesPage, salesPageSchema } from '../shared/sales-page';
import { SalesPageView } from '../web/src/sales-page';

describe('CR JORNADA — pagina comercial explicativa e original', () => {
  it('valida textos detalhados e etapas sem tabela de precos inventados', () => {
    const parsed = salesPageSchema.safeParse(defaultSalesPage);
    expect(parsed.success).toBe(true);
    expect(defaultSalesPage.features?.length).toBeGreaterThanOrEqual(3);
    expect(defaultSalesPage.steps?.length).toBeGreaterThanOrEqual(3);
    expect(defaultSalesPage.features?.every(x =>
      x.description.length >= 24 &&
      ['planned','testing','available'].includes(x.stage)
    )).toBe(true);
    expect(defaultSalesPage.features?.every(x => x.stage !== 'available')).toBe(true);
    expect(defaultSalesPage.plans.every(p => p.price === 'Sob consulta')).toBe(true);
  });

  it('preserva configuracoes antigas gravadas no banco sem as novas secoes', () => {
    const oldConfig = { ...defaultSalesPage };
    delete oldConfig.features;
    delete oldConfig.steps;
    const parsed = salesPageSchema.safeParse(oldConfig);
    expect(parsed.success).toBe(true);
    const html = renderToStaticMarkup(createElement(SalesPageView, {
      config: parsed.success ? parsed.data : oldConfig,
      status: 'editing'
    }));
    expect(html).toContain('id="recursos"');
    expect(html).toContain('id="como-funciona"');
    expect(html).toContain('Em validação');
  });

  it('mostra explicacoes, etapas, planos, duvidas e limites dos modulos', () => {
    const html = renderToStaticMarkup(createElement(SalesPageView, {
      config: defaultSalesPage, status: 'preview'
    }));
    expect(html).toContain('id="recursos"');
    expect(html).toContain('id="beneficios"');
    expect(html).toContain('id="como-funciona"');
    expect(html).toContain('id="planos"');
    expect(html).toContain('id="duvidas"');
    expect(html).toContain('Registros de entrada, intervalo e saída');
    expect(html).toContain('Gestão de escalas e horários');
    expect(html).toContain('Conheça os recursos');
    expect(html).toContain('Implantação responsável');
    expect(html).toContain('Sob consulta');
    expect(html).not.toContain('Reconhecimento facial');
    expect(html).not.toContain('Portaria 671');
    expect(html).not.toContain('100% conforme');
  });

  it('aceita explicacoes editadas sem executar HTML do administrador', () => {
    const edited = {
      ...defaultSalesPage,
      features: [{
        title: 'Módulo personalizado',
        description: '<script>alert(1)</script> — conteúdo meramente explicativo.',
        stage: 'planned' as const
      }, ...(defaultSalesPage.features || []).slice(1,3)]
    };
    const html = renderToStaticMarkup(createElement(SalesPageView, {
      config: edited, status: 'editing'
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejeita funcionalidade sem descricao suficiente ou com estado invalido', () => {
    const bad = {
      ...defaultSalesPage,
      features: [{ title: 'Modulo curto', description: 'Frase curta', stage: 'done' }]
    };
    expect(salesPageSchema.safeParse(bad).success).toBe(false);
  });
});
