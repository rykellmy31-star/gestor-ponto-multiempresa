# CR JORNADA — homologacao staging isolada

O banco de producao **cr-jornada-db** ja recebeu 38 migrations em 2026-10-21. A instalacao foi encerrada e o job remoto de inicializacao foi desativado. **Nao recriar ou aplicar migrations no banco de producao durante a homologacao.**

## Simulacao automatica atual

O GitHub Actions em `desenvolvimento-cr-jornada` executa a criacao local de `wrangler.staging.jsonc` com um UUID ficticio e roda **somente** `wrangler deploy --dry-run`. Isto verifica se o Worker compila para um ambiente staging e **nao publica Worker nem cria D1**.

A configuracao staging e construida por lista positiva e somente copia `main`, data/flags de compatibilidade, diretorio de assets, regras de bundling, observabilidade nao sensivel e localizacao das migrations. Todos os bindings remotos extras, crons, routes e variaveis da producao sao descartados. As funcoes de jornadas, cadastro, recuperacao, batidas e leads permanecem desligadas.

## Homologacao remota futura (ainda nao realizada)

1. Auditar integralmente tenant isolation das rotas habilitadas, dos endpoints legados e triggers SQL. Os testes existentes ainda nao substituem revisao e testes de penetracao.
2. Criar **banco D1 staging distinto**, obter seu ID real e confirmar por inventario que nao corresponde a nenhum banco de producao.
3. Criar **Worker staging separado**, com hostname proprio, sem custom domain ou cron, e configurar nele seus **proprios secrets**. Nao copiar tokens, cookies ou dados reais da producao.
4. Gerar a configuracao com `npm run cloudflare:prepare-staging -- --worker cr-jornada-staging --database cr-jornada-staging-db --database-id UUID_REAL_STAGING --origin https://CR-JORNADA-STAGING.workers.dev`.
5. Executar migrations com config staging, popular somente fixtures ficticias, validar isolamento com empresas A/B, CSP, cookies, CSRF, sessoes, jornada e ponto; registrar resultados antes da liberacao da trava de deploy.

**Alvo conciliado em 2026-10-21:** o arquivo principal agora aponta para o Worker publico `gestor-ponto-multiempresa`, origem `https://gestor-ponto-multiempresa.netssh3-0.workers.dev` e banco D1 `cr-jornada-db`, conforme auditoria remota somente leitura. `scripts/verify-production-target.mjs` impede configuracoes divergentes, mas **nao autoriza deploy**. `scripts/preflight.mjs` continua bloqueando publicacao ate a revisao integral do isolamento multiempresa e homologacao.

## Permissoes

O token temporario `CLOUDFLARE_D1_SETUP_TOKEN` foi revogado pelo proprietario; nao e necessario para o CI somente leitura nem para o dry-run. Nenhum acesso de escrita Cloudflare e solicitado por este procedimento.
