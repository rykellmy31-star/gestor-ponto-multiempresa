# CR JORNADA — estado real do desenvolvimento

Atualizado em 19/10/2026. Repositório oficial:
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
