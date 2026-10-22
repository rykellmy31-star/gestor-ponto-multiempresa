import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalesPageView, isSalesPreviewHost } from '../web/src/sales-page';
import { defaultSalesPage } from '../shared/sales-page';

describe('CR JORNADA — pre-visualizacao privada da pagina comercial', () => {
  it('so mostra ofertas ficticias no Pages e no desenvolvimento local', () => {
    expect(isSalesPreviewHost('cr-jornada-preview.pages.dev')).toBe(true);
    expect(isSalesPreviewHost('localhost')).toBe(true);
    expect(isSalesPreviewHost('127.0.0.1')).toBe(true);
    expect(isSalesPreviewHost('cr-jornada.com.br')).toBe(false);
    expect(isSalesPreviewHost('cr-jornada.workers.dev')).toBe(false);
    expect(isSalesPreviewHost('pages.dev.malicioso.tld')).toBe(false);
  });

  it('mostra alteracoes da pagina sem salvar em banco', () => {
    const page = {
      ...defaultSalesPage,
      headline: 'Gestao de jornada personalizavel de exemplo',
      plans: [{
        ...defaultSalesPage.plans[0],
        name: 'Plano Teste Especial',
        price: 'Sob consulta'
      }]
    };
    const html = renderToStaticMarkup(
      createElement(SalesPageView, { config: page, status: 'editing' })
    );
    expect(html).toContain('Gestao de jornada personalizavel de exemplo');
    expect(html).toContain('Plano Teste Especial');
    expect(html).toContain('PRÉVIA PRIVADA');
    expect(html).not.toContain('checkout.exemplo.com');
  });

  it('impede botoes de checkout e canais externos no rascunho', () => {
    const page = {
      ...defaultSalesPage,
      whatsapp: '5573999999999',
      contact_email: 'teste@exemplo.com',
      plans: [{
        ...defaultSalesPage.plans[0],
        checkout_url: 'https://checkout.exemplo.com/plano-teste'
      }]
    };
    const html = renderToStaticMarkup(
      createElement(SalesPageView, { config: page, status: 'editing' })
    );
    expect(html).not.toContain('https://wa.me/');
    expect(html).not.toContain('https://checkout.exemplo.com/');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('PRÉVIA PRIVADA');
  });

  it('escapa textos arbitrarios ao renderizar o rascunho', () => {
    const html = renderToStaticMarkup(createElement(SalesPageView, {
      config: {
        ...defaultSalesPage,
        headline: '<script>alert(1)</script> - Teste'
      },
      status: 'editing'
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
