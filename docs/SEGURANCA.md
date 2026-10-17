# Segurança, privacidade e limites

## Modelo de implantação

Um único Cloudflare Worker serve a API e os arquivos React, com D1 vinculado como `DB`. Não há banco em localStorage, senha incorporada no frontend ou dependência de CDN no navegador. As páginas privadas passam primeiro pelo Worker (`run_worker_first: true`); a API aplica autorização independentemente da página.

Produção exige origem HTTPS canônica real e `ENVIRONMENT=production`. A configuração entregue é preparada para **Workers Paid**, com CPU de até 30s por requisição; não foi homologada no plano gratuito. Não reduza o custo do hash para tentar caber numa franquia menor. Faça teste de carga, custo e quotas antes da operação.

## Controles implementados

### Autenticação

- scrypt nativo `node:crypto`, N=32768, r=8, p=3, salt aleatório de 24 bytes e derivação de 64 bytes.
- Pepper independente (`AUTH_PEPPER`) aplicado com HMAC; comparação de segredo em tempo constante.
- Senha entre 12 e 128 caracteres, troca inicial obrigatória para contas criadas no painel, sem senha padrão.
- Login com erro genérico; conta inexistente também percorre derivação de senha para reduzir diferença grosseira de tempo.
- Limite por IP e identificador, também em reautenticação/recuperação/setup, com contador persistente D1. Resposta 429 e Retry-After.
- Não há MFA/WebAuthn nesta versão. É recomendável camada adicional de proteção de conta/borda para a administração, além da autenticação própria obrigatória do sistema.

### Sessão e autorização

- Cookies separados por realm: `__Host-jornada_admin` e `__Host-jornada_employee` em produção, Secure, HttpOnly, SameSite=Strict e Path=/.
- Token aleatório, somente hash SHA-256 no banco; CSRF por sessão e validação de origem nas mutações.
- Prazo absoluto configurável de 1–12h, padrão 8h; inatividade máxima de 30min para admin / 60min para funcionário. Horário de último acesso atualizado no servidor.
- Logout, troca/reset de senha, bloqueio e revogação de sessões têm efeito no servidor. `auth_version` invalida também uma sessão antiga criada em corrida com alteração de credenciais; revogar todas as sessões avança essa versão.
- Operações críticas requerem reautenticação recente de até 10min. Esconder um botão ou conhecer uma URL não concede privilégio.
- Funcionário não escolhe `employee_id`, role ou timestamps na operação de ponto. Seu relatório sempre usa o vínculo da sessão, não um ID de outra pessoa enviado pelo cliente.
- Novos administradores só são criados por administrador autorizado; bootstrap inicial exige Secret e trava persistente/atômica.

### Dados e aplicação

- SQL com parâmetros vinculados, validação Zod e esquemas estritos nas mutações sensíveis; limites de corpo e de campos.
- React renderiza dados como texto, não HTML fornecido pelo usuário; CSP local/self, object-src none, base-uri e form-action restritos.
- No-store/private para páginas HTML e APIs; nosniff, Referrer-Policy e Permissions-Policy. Em produção, HSTS, X-Frame-Options DENY e frame-ancestors none.
- CPF opcional, validado, AES-GCM com IV aleatório e `DATA_KEY` independente; número completo não é devolvido ao navegador. Nome, matrícula, e-mail, cargo e histórico continuam sendo dados pessoais, mesmo sem CPF.
- Marcas UTC originais, ajustes e auditoria têm proteção contra alteração/exclusão pela aplicação e triggers SQL. Fechamentos usam snapshots/versionamento/hash e proteção contra gravações concorrentes.
- Motivos obrigatórios para ajustes, decisões de revisão e reabertura; alterações cadastrais relevantes têm valores anteriores/novos não secretos na auditoria. Senhas, cookies, tokens de reset, CPF integral e chaves não são registrados nela.
- Exportação CSV neutraliza começo de fórmula e usa campos entre aspas. PDF inclui informações reais, originais de dias tratados e notas longas paginadas.
- Fontes e código do navegador são locais. Resend, se habilitado, é chamado somente pelo backend para recuperação por e-mail.

## Recuperação de senha

A resposta pública não confirma a existência de uma conta. O pedido pode ser atendido pelo responsável, após validação humana de identidade e reautenticação, com link único de 30 minutos. O token fica somente como hash no banco. A conclusão revoga sessões e outros links do usuário.

Sem outro administrador, a ferramenta `admin:recover` exige a autorização privilegiada Cloudflare e atua somente sobre administrador já existente. Não há endpoint de emergência público ou senha mestra. O link emitido no terminal **é um segredo temporário**: não capture em logs de CI, screenshots ou suporte.

### E-mail automático opcional

Não foi configurado/testado com provedor real nesta entrega. A recuperação **assistida foi testada ponta a ponta** e funciona sem e-mail.

Para habilitar o envio implementado via Resend:

1. Tenha domínio/remetente verificado no provedor e faça sua própria revisão de tratamento/transferência de dados.
2. Instale `MAIL_API_KEY` como Secret do Worker e `MAIL_FROM` como Secret ou variável de servidor; formato de remetente autorizado, por exemplo o nome da empresa seguido do endereço verificado.
3. Confirme `APP_ORIGIN` para que o link aponte ao domínio certo.
4. Teste entrega, spam, prazo, uso único e revogação em homologação. Falha do provedor não deve ser interpretada como confirmação de entrega.

Não existe conector/mailbox ativo ou serviço de envio fornecido junto do projeto. Custos e entregabilidade dependem da sua conta no provedor.

## Administração de Secrets e retenção

- `.dev.vars`, `.env*`, `.data`, `.test-data`, backups e contextos privados estão fora do pacote de entrega/repositório. O exemplo `.dev.vars.example` contém apenas instruções/valores não utilizáveis.
- Não publique logs com corpo de login, Authorization, Cookie, chave de configuração ou URL com token.
- Não rotacione `AUTH_PEPPER`/`DATA_KEY` arbitrariamente: a versão não inclui migração automatizada de chaves de CPF ou rehash em massa. Uma rotação requer plano e preservação das chaves necessárias aos backups.
- Backups são cifrados; a frase e os Secrets devem ficar em cofre separado. O script não configura agendamento externo/retention por conta própria.
- Sessões/tokens/baldes expirados podem ser limpos por manutenção privilegiada revisada; são recusados pela aplicação mesmo enquanto a linha existir. Não há cron automático instalado.
- Audite administradores, autorizações Cloudflare e operadores do backup. O proprietário do D1 pode executar SQL/dropar triggers: a imutabilidade da aplicação **não equivale a armazenamento WORM ou selo fiscal inviolável**.
- Faça registro de operadores, finalidade/base legal, política de acesso, prazos de retenção e atendimento de direitos LGPD com orientação competente. Não guarde diagnóstico médico ou anexos sensíveis desnecessários nas justificativas.

## Escopo e limitações declaradas

1. **Produção não publicada/testada nesta entrega.** A prévia usa banco local persistente no ambiente; não substitui hospedagem estável, SLA, backup externo ou edge remoto.
2. Sem teste de carga/penetração independente ou promessa de escala ilimitada. Testes funcionais usam poucas pessoas/meses em banco isolado; dimensione CPU/D1, monitore latência, falhas e quotas na conta real.
3. Uma empresa por instalação e dois perfis (admin e funcionário). Sem múltiplos tenants, chefia intermediária, MFA, SSO, geofencing, biometria ou geolocalização.
4. Quatro marcas/dia e um intervalo. Sem fila offline, múltiplas jornadas no mesmo dia ou escala 12×36 automática; feriados devem ser cadastrados.
5. Saldo do período com aprovação, não razão completa de banco de horas com vencimentos/transporte, nem folha financeira/DSR/adicional noturno legal.
6. PDF/CSV e impressão estão implementados. Exportador Excel `.xlsx` nativo e anexos médicos não foram incluídos. O PDF usa fonte latina com acentos portugueses; sinais de saldo são normalizados para hífen legível no PDF. Valide nomes em alfabetos fora da cobertura da fonte antes do uso.
7. E-mail automático e restauração/time-travel **remotos** dependem de configuração e ensaio da sua conta; somente o fluxo assistido e a restauração local foram verificados.
8. O preview de desenvolvimento permite enquadramento pela Arena e origens locais/e2b estritamente no modo não produtivo. Essas exceções não são habilitadas em produção. Não ofereça `dev:web`/Vite ou Wrangler dev na internet como serviço definitivo.

## Limite jurídico — REP-P

Este aplicativo **não é apresentado como REP-P certificado/conforme para uso oficial**. Não inclui registro INPI exigível, comprovantes com assinatura PAdES/ICP-Brasil, arquivos fiscais AFD/AEJ nos layouts oficiais, assinaturas CAdES ou os demais requisitos formais de um REP-P regulamentado. O hash de fechamento é um controle de integridade técnica, não assinatura ICP-Brasil.

A operação como sistema oficial de registro de jornada no Brasil exige análise e adequações específicas à legislação, ao regime de registro, ao instrumento coletivo e às obrigações do empregador. Antes desse uso, submeta o projeto à avaliação jurídica/trabalhista e, quando aplicável, escolha/adapte uma solução que cumpra integralmente os requisitos oficiais.

Referências: [MTE — Registro eletrônico de ponto](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep), [MTE — perguntas e respostas REP](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP), [Workers crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
