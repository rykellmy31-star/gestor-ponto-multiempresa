# CR JORNADA — Página pública de vendas configurável

## Objetivo
O Superadmin cadastra e edita a página comercial, incluindo títulos, subtítulos, descrição para Google, cor, logotipo externo HTTPS, vantagens, até quatro planos, até oito respostas de dúvidas, telefone WhatsApp e e-mail opcional.

### Rotas
- **Público:** `/vendas` (`/planos` redireciona para ela).
- **Painel autenticado:** `/superadmin/vendas` (menu «Página de vendas» dentro do Superadmin).
- **Leitura pública:** `GET /api/public/sales-page`. Somente `published_json` se estiver publicado. Rascunhos e dados administrativos não são retornados.
- **Leitura do administrador:** `GET /api/platform/sales-page`.
- **Salvar rascunho / salvar e publicar:** `PUT /api/platform/sales-page`.
- **Retirar do ar:** `POST /api/platform/sales-page/unpublish`.

## Como funciona
- `migrations/0021_sales_page_settings.sql` mantém `draft_json` **separado** de `published_json`, com revisão, estado de publicação, data e responsável.
- **Salvar como rascunho** não modifica o conteúdo publicado.
- **Salvar e publicar** salva a nova versão no D1; a página pública busca os dados mais recentes diretamente da API, sem recompilar o frontend.
- **Retirar do ar** requer confirmação do Superadmin; nenhuma configuração é apagada.
- `revision` e `expected_revision` evitam sobrescrita concorrente de edições.
- A auditoria da plataforma é registrada por triggers D1 no mesmo ato da alteração.
- Somente sessões Superadmin válidas podem ler/escrever configurações, com CSRF para alterações; os endpoints públicos são somente leitura.
- O número WhatsApp não está configurado por padrão. Preencha **55 + DDD + número**, somente algarismos. A mensagem pré-preenchida é editável.
- O preço começa como **«Sob consulta»**. Os preços, períodos e funcionalidades descritas pelo Superadmin precisam corresponder ao serviço realmente oferecido.
- O campo de checkout aceita apenas URL externa HTTPS; não há processamento de cartões, assinaturas automáticas nem integração de pagamentos desenvolvida nesta etapa. Sem URL de checkout, o botão leva ao WhatsApp se houver contato.
- Para publicar é obrigatório ter **WhatsApp ou pelo menos um checkout HTTPS**.

## Cloudflare Pages e prévia
- O Pages atual publica **somente arquivos estáticos** e não tem conexão D1 ou login de Superadmin.
- Enquanto a API real não estiver disponível, `/vendas` exibe **prévia visual explicitamente identificada**, sem links de compra/contato fictícios.
- Alterações reais pelo Superadmin exigem **um Worker próprio do CR JORNADA com D1 migrado e segredos isolados**, no mesmo domínio do frontend; **não** configurar Pages para apontar ao Worker antigo da Farmácia Pague Pouco.
- A funcionalidade está implementada na branch `desenvolvimento-cr-jornada`, não publicada em backend remoto. Não migrar, efetuar deploy ou integrar checkout sem homologação e autorização explícitas.

## Google e SEO
- Há título, descrição, metadados dinâmicos e configuração para que a página comercial possa ser indexada **somente quando publicada**.
- O arquivo `web/public/robots.txt` impede rastreamento dos caminhos de administração e acesso.
- **Criar a página não garante aparecer no Google**: depois do lançamento oficial, configurar domínio público, canonical URL e sitemap com o endereço real, verificar a propriedade no Google Search Console, enviar a URL e solicitar indexação.
- Avaliar renderização de metadados no HTML servido pelo Worker para buscadores que não executam JavaScript. A versão inicial usa React para preencher os metadados.
- Antes de vender, definir preços, planos entregáveis, meios de pagamento/checkout, termos de serviço, política de privacidade (LGPD), suporte e homologação trabalhista se fizer alegações sobre ponto eletrônico regulamentado.

## Testes
- `tests/platform-sales.test.ts`: autorização, rascunho privado, publicação, CSRF, revisão concorrente, validação de URL e WhatsApp.
- `tests/d1-platform-sales.test.ts`: migração local, auditabilidade, rascunho separado, publicação e retirada do ar.

## Pendências
1. Homologar as migrações e recursos em D1 local e depois em staging separado mediante autorização.
2. Configurar o número real de contato e eventual checkout externo.
3. Publicar com domínio real, HTTPS e configurar o Google Search Console.
4. Revisar ofertas, conformidade, contrato e políticas antes da primeira venda.
