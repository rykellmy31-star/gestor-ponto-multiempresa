import { describe, expect, it } from 'vitest';
import { renderSalesHead } from '../server/core/sales-seo';

const html = '<!doctype html><html><head><title>CR JORNADA · Gestão de ponto</title>' +
  '<meta name="description" content="Antiga descrição"/>' +
  '</head><body><div id="root"></div></body></html>';

describe('CR JORNADA — indexacao segura da pagina comercial no Worker', () => {
  it('publica titulo, descricao, Open Graph e canonical direto no HTML', () => {
    const output = renderSalesHead(html, {
      headline: 'Controle de jornadas para empresas',
      description: 'Conheça a gestão de jornadas do CR JORNADA'
    }, 'https://exemplo.test/vendas');
    expect(output).toContain('<title>CR JORNADA | Controle de jornadas para empresas</title>');
    expect(output).toContain('content="index, follow"');
    expect(output).toContain('property="og:description"');
    expect(output).toContain('rel="canonical" href="https://exemplo.test/vendas"');
    expect(output).not.toContain('Antiga descrição');
  });

  it('nao indexa rascunho ou pagina ainda nao publicada', () => {
    const output = renderSalesHead(html, null, 'https://exemplo.test/vendas');
    expect(output).toContain('content="noindex, nofollow"');
    expect(output).not.toContain('Antiga descrição');
  });

  it('escapa titulo, descricao e url antes de inserir no head', () => {
    const output = renderSalesHead(html, {
      headline: '<script>alert("oi")</script>',
      description: 'Empresa" /><img src=x onerror=alert(1)>'
    }, 'https://exemplo.test/vendas?a="1"');
    expect(output).not.toContain('<script>');
    expect(output).not.toContain('<img');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('&quot;');
    expect(output).not.toContain('href="https://exemplo.test/vendas?a="1""');
  });
});
