import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DeveloperCredit, developerCredit
} from '../web/src/developer-credit';

describe('CR JORNADA - credito global do desenvolvedor', () => {
  it('exibe a assinatura completa solicitada', () => {
    expect(developerCredit).toBe(
      'Sistema desenvolvido por Carlos Rykellmy Santos Correia'
    );
  });

  it('renderiza rodape sem depender de autenticacao ou rede', () => {
    const html = renderToStaticMarkup(createElement(DeveloperCredit));
    expect(html).toContain('<footer');
    expect(html).toContain('cr-site-credit');
    expect(html).toContain('Créditos de desenvolvimento');
    expect(html).toContain(developerCredit);
  });
});
