# CR JORNADA — estado real do desenvolvimento

Estado atual: staging real em funcionamento, 42 migrations. Produção preservada nesta entrega, com última comprovação de 38. Feriados, ocorrências aprovadas pelo gestor e ajustes versionados foram homologados com duas empresas fictícias, preservando todas as marcações originais.

Evidência atual: código `d5a0be5dc9160a2ea86f598f4aaec88fa90c791d`, homologação `39709068643`: **298 verificações reais aprovadas**. CI `39709068691` integralmente aprovado. Recuperação do schema 42: **56 tabelas**, schema/hashes idênticos, SHA256/AES-256-GCM e adulteração rejeitada; clone `0ed425fc-25e2-461a-8003-ca85bc5fc4a6`. A chave do ensaio é efêmera, não substitui backup operacional. Conta do proprietário ativada somente no staging com troca obrigatória no primeiro acesso (`39709756387`).

Progresso por checklist: **85,00% (17/20 blocos comprovados)**. Critérios e limites em [docs/CRITERIOS-HOMOLOGACAO.md](docs/CRITERIOS-HOMOLOGACAO.md). A apuração aberta continua provisória; o fechamento guarda um snapshot imutável. Ajustes não modificam comprovantes e turnos originais incompletos impedem o fechamento. Fechamento e reabertura com snapshots foram homologados em `39706943984`: 298 verificações e restauração de 55 tabelas. O bloco 18 permanece parcial: reconciliação de históricos e decisões de extras ainda pendentes. Publicação de produção bloqueada até completar esse bloco, auditoria integral, backup operacional durável, credenciais iniciais do proprietário e liberação autorizada.

## Acesso do proprietário — 22/10/2026

Conta do proprietário ativada no staging pelo Actions `39709756387`, com troca obrigatória no primeiro acesso. Código `d5a0be5dc9160a2ea86f598f4aaec88fa90c791d`: CI `39709068691` aprovado integralmente; homologação `39709068643` com 298 verificações reais e restauração de 56 tabelas. O pedido de ativação contém somente envelope cifrado. Detalhes em `docs/ACESSO-PROPRIETARIO-STAGING.md`. Produção não alterada; progresso permanece 85,00% (17/20).

## Registro histórico — 19/10/2026

As seções seguintes registram uma etapa anterior e não substituem o checklist atual. Repositório oficial:
`rykellmy31-star/gestor-ponto-multiempresa`, branch `desenvolvimento-cr-jornada`, PR #1.

## Implementado na branch

- Superadmin: autenticação, empresas, administradores empresariais e auditoria.
- Gestores empresariais: login, sessões com empresa, troca obrigatória de senha,
  recuperação assistida pelo Superadmin com senha provisória de 24 horas.
- Concorrência: criação de sessão revalida credenciais e empresa no SQL;
  migração 0026 permite abortar integralmente conflitos de senha/status de gestor.
- Funcionários: login CPF, seleção de empresa entre vínculos autorizados,
  troca de senha, sessões empresariais, histórico mensal e extrato CSV informativo.
- Jornadas: propriedade por empresa, atribuição auditada e horários por dia
  (incluindo configuração diferente para sábado).
- Ponto: novas rotas com sequência, hora do servidor, CSRF e idempotência,
  preparadas para homologação e desativadas por padrão.
- Página comercial: edição pelo Superadmin, rascunho, prévia e publicação;
  captação comercial com consentimento e retenção, condicionada a configuração.
- Demonstração de Superadmin: dados fictícios apenas em memória.

## Barreiras que continuam obrigatórias

**Não está liberado para produção. Não mesclar PR ou remover o preflight.**

As rotas legadas de empresa única continuam bloqueadas. A existência de novas
rotas isoladas não autoriza abrir as antigas. Os dados legados não são
reconciliados nem importados automaticamente. Migrações aditivas preservam
vínculos legados nulos até reconciliação explícita e autorizada.

- `ENABLE_EMPLOYEE_PUNCHES` e política empresarial de ponto: não ativadas.
- `ENABLE_COMPANY_SCHEDULES`: não ativada na configuração versionada.
- Coleta comercial real: não ativada; exige política de privacidade, retenção
  válida, flags e aprovação do conteúdo comercial.
- `scripts/preflight.mjs` continua bloqueando publicação intencionalmente.
- `wrangler.jsonc` contém configuração remota: nunca usá-la para publicar testes.
- Nenhum deploy, migração remota ou alteração da Farmácia Pague Pouco nesta rodada.

## Evidência desta rodada

- `npm run typecheck`: aprovado.
- `npm run typecheck:tests`: aprovado; agora obrigatório no CI.
- Testes rápidos: **33 arquivos / 268 testes aprovados**.
- Dois novos testes reais de D1/Miniflare aprovados: rollback atômico e alterações
  concorrentes durante login com hash scrypt real.
- Teste Wrangler de migrações/senhas empresariais aprovado em D1 exclusivamente local.
- As 26 migrações aplicadas em SQLite temporário: integridade `ok`, sem erros de FK.
  Esse smoke test complementa os testes D1; não substitui homologação remota.
- `npm run build:web`: aprovado.
- GitHub Actions: consultar o SHA mais recente do PR. Não usar aprovação de um
  commit anterior como evidência do último. Rodadas antigas podem ser canceladas
  automaticamente por concorrência.
- Verificação visual por navegador pendente: Chromium não estava disponível e
  o download do Playwright falhou neste ambiente. Não foi alegada aprovação visual.

## Pendências antes de qualquer liberação

1. Concluir todos os jobs do GitHub Actions no último commit e corrigir falhas.
2. Homologar em Worker e novo D1 separados, mediante autorização de provisionamento,
   segredos exclusivos e dados fictícios. Nunca usar o banco da Farmácia.
3. Revisar matrícula/vínculos e isolamento integral das tabelas e rotas legadas,
   inclusive regras, feriados, ajustes, ocorrências, fechamento e relatórios.
4. Homologar recuperação de acesso, entrega segura das senhas provisórias,
   notificações e recuperação do funcionário. Não existe envio automático de email.
5. Validar virada de dia/jornadas noturnas, cálculo completo, fechamento,
   comprovantes e requisitos trabalhistas. CSV é apenas extrato informativo.
6. Testar backup, restauração e rollback em banco isolado; definir reconciliação
   explícita dos dados antigos antes de qualquer proposta de migração real.
7. Executar a verificação visual responsiva e a matriz de homologação descrita em
   `docs/HOMOLOGACAO-CR-JORNADA.md`.

As decisões comerciais, credenciais e autorizações de produção permanecem como
pendências; não impedem auditorias e implementação na branch de desenvolvimento.

## Correções encontradas no acompanhamento do CI

A execução anterior falhava em `d1-employee-company-workdays` porque a fixture
usava `inactive`, valor inexistente no CHECK de funcionários. A fixture agora
usa `blocked`, mantendo a expectativa de negar vínculo para funcionário bloqueado.

A auditoria de dependências identificou três alertas na cadeia do Vitest 3.
A atualização explícita para **Vitest 5.0.5** preservou os 268 testes rápidos e
removeu os alertas reportados (`npm audit`: zero no momento da verificação).
O CI passa a auditar todas as dependências com limite de severidade `moderate`.
Isso não substitui a validação completa dos shards D1 no último commit.
