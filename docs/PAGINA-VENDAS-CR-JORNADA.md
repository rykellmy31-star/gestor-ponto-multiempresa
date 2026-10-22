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


## Nova apresentação explicativa (referência editorial, não reprodução)
A estrutura editorial foi inspirada **somente na clareza** de uma página pública de apresentação de software de gestão de ponto: começo com proposta de valor, descrição objetiva das funções, benefícios, etapas práticas e depois comparação de planos.

**Identidade, cores, gráficos ilustrativos, textos, nomes e funcionalidades descritas são próprios do CR JORNADA.** Não copiar logomarcas, fotografias, preços, textos ou reivindicações de legislação de terceiros.

A página `/vendas` agora organiza o conteúdo em:
1. Proposta central e botões para conhecer recursos/planos.
2. **Recursos explicados**: de 3 a 6 cartões com nome, parágrafo detalhado e estágio `Planejado`, `Em validação` ou `Disponível`.
3. Benefícios para a rotina de empresa e funcionários.
4. **Como funciona a implantação**: de 3 a 5 etapas personalizadas, com orientação de que o início de marcações depende de testes e aprovação.
5. Planos com condições editáveis, sem preços inventados.
6. Perguntas frequentes, contatos opcionais e rodapé.

Em `/superadmin/vendas`, o editor permite mudar textos, status reais, ordem, remover e acrescentar recursos e etapas, além dos demais campos já existentes. Somente marcar um recurso como `Disponível` quando estiver de fato homologado. O preview privado permite conferir o resultado sem salvar nem publicar.

Compatibilidade: `features` e `steps` são campos **opcionais** no schema compartilhado. Configurações existentes no D1 continuam válidas; quando ausentes, a página usa descrições sugeridas, que o Superadmin pode personalizar. Nenhuma migração adicional no D1 é necessária para esses campos porque a página comercial já armazena JSON.

Os rótulos não prometem certificação legal, reconhecimento facial, aplicativos nativos, funcionamento offline nem redução estatística de custos. A publicação comercial definitiva exige verificação real dos recursos disponíveis, das condições de contratação e da legislação aplicável.


## Solicitações comerciais sem WhatsApp — implementação em desenvolvimento
A página de vendas pode receber pedidos de informação pelo próprio site. Essa funcionalidade foi adicionada para que um visitante interessado entre em contato **sem precisar de telefone ou checkout de pagamento**.

- Configuração editável: `lead_form_enabled`, **desativada por padrão**; é armazenada no JSON comercial e mantém compatibilidade com configurações antigas.
- Formulário público: nome, e-mail, empresa opcional, plano opcional e mensagem, com autorização expressa para resposta comercial. Não solicita CPF, documentos, telefone, senha, dados de empregados nem pagamento.
- Endpoint: `POST /api/public/leads`, acessível somente quando a página **está publicada**, o Superadmin habilitou o formulário e o Worker foi homologado com `ENABLE_SALES_LEADS=true`. Sem ambos, a API nega o envio.
- O formulário exige validação de dados e consentimento, confirma o recebimento **somente após resposta HTTP bem-sucedida**, usa armadilha anti-bot e limite de cinco solicitações por IP em uma hora. O IP é usado somente em limite protegido por HMAC; não integra a tabela de solicitações.
- Banco: migração **0022** `sales_leads`, separada dos registros trabalhistas e dos dados de funcionários.
- Caixa de entrada do Superadmin: `GET /api/platform/leads`; status `PATCH /api/platform/leads/:id`; exclusão `DELETE /api/platform/leads/:id`. Todos os dados e alterações requerem autenticação Superadmin; mudanças exigem CSRF.
- **Não há envio automático de e-mail**, pagamento ou disparos de WhatsApp. O Superadmin deve consultar a caixa de entrada e responder manualmente pelo endereço informado.
- O Pages de demonstração exibe apenas o formulário desativado. **Nenhum dado real deve ser enviado pela prévia.**

### Pendências obrigatórias antes da ativação
1. Publicar aviso/política de privacidade revisados, detalhando controlador, finalidade, segurança, prazo de retenção e canal para solicitações de titulares (LGPD).
2. Implantar e testar uma rotina de exclusão automática conforme prazo de retenção aprovado, além da exclusão manual já implementada.
3. Revisar antispam, origem, abuso distribuído e limite de solicitações, incluindo eventual Turnstile e alertas de novas mensagens.
4. Executar testes de migração **somente D1 local**, e em seguida staging **separado**, com credenciais de teste. Só ativar `ENABLE_SALES_LEADS` após aprovação e autorização.
5. Nenhum deploy de Worker ou migração remota foi realizado nesta etapa.


## Retenção de dados e política de privacidade — implementação adicional
- O editor `/superadmin/vendas` agora recebe a **URL HTTPS de uma política de privacidade** quando o formulário de interesse estiver habilitado. O visitante encontra o link junto ao consentimento.
- A API se recusa a publicar o formulário sem a URL; nenhuma política fictícia foi criada nem presumida como juridicamente adequada.
- O Worker precisa ter `ENABLE_SALES_LEADS=true` **e** `SALES_LEADS_RETENTION_DAYS` com um valor inteiro entre **30 e 365 dias**. Ambas as configurações ficam ausentes/desligadas por padrão no repositório. **O período precisa ser definido pelo responsável pela operação após análise da finalidade e das obrigações legais.**
- `server/core/sales-leads-retention.ts` restringe o descarte à tabela `sales_leads`, filtrando por `created_at` com lotes limitados. Não altera `employees`, `punches`, sessões, escalas ou dados das empresas.
- `server/index.ts` possui uma rotina `scheduled` que faz a limpeza em lotes de até 100 solicitações, limitado a 20 lotes por execução. Se a flag estiver desligada ou o prazo não for válido, não executa consultas nem exclusões.
- A configuração `wrangler.jsonc` declara execução diária às **04:00 UTC**. **Nenhum Worker foi implantado e nenhum agendamento foi ativado remotamente** nesta rodada: configuração e código estão somente na branch `desenvolvimento-cr-jornada`. O cron só funcionará depois de uma implantação explicitamente autorizada do Worker com D1 próprio e as flags aprovadas.
- Os testes verificam o prazo configurado, a impossibilidade de limpar outros dados e a preservação de solicitações recentes no D1 local.

**Pendências antes da ativação real:** revisar e publicar a política adequada à LGPD, estabelecer o prazo de retenção da operação, testar o cron em staging isolado, conferir alertas, backups, exclusões e procedimentos para solicitações de titulares. Não usar dados pessoais verdadeiros na prévia Cloudflare Pages.
