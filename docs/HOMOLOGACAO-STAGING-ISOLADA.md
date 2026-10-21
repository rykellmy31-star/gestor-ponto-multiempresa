# CR JORNADA — homologacao staging isolada

O banco de producao **cr-jornada-db** ja recebeu 38 migrations em 2026-10-21. A instalacao foi encerrada e o job remoto de inicializacao foi desativado. **Nao recriar ou aplicar migrations no banco de producao durante a homologacao.**

## Homologacao remota executada em 2026-10-21

- Worker: `gestor-ponto-multiempresa-staging`.
- Origem confirmada por health check HTTPS: `https://gestor-ponto-multiempresa-staging.netssh3-0.workers.dev`.
- D1: `cr-jornada-staging-db`, ID `41604781-5fbf-4287-beca-64e20ce1ee1f`.
- 38 migrations aplicadas no staging. Nenhuma migration de producao foi reexecutada.
- Secrets AUTH_PEPPER, DATA_KEY e CPF_LOOKUP_SECRET gerados exclusivamente para staging. Nenhuma chave de producao copiada.
- Infraestrutura aprovada no Actions `39659601404`, commit `0b67c58fa55eae04b0fca0802ef40d4b34ddebb8`.
- Fluxos HTTP reais: **147 verificacoes aprovadas** no Actions `39660905427`, commit `49e2494c15ec94c15b9af51cb7a183cc7844222e`. O job completo falhou depois, na etapa separada de restauracao remota: nao classificar toda a execucao como aprovada.

`scripts/exercise-cloudflare-staging.mjs` exercita Superadmin, duas empresas ficticias, administradores com troca inicial de senha, cadastro de funcionarios, CPF com dois vinculos, isolamento de listas/historico, jornadas por dia, atribuicao em lote, repeticao idempotente, quatro batidas de ponto por funcionario e revogacao de sessoes ao suspender/reativar uma empresa.

As politicas de ponto das duas empresas sao fixtures inseridas diretamente no D1 staging pelo teste. Isso **nao comprova configuracao de politica pelo painel**. O fluxo de interface, relatorios empresariais/exportacoes e as rotas legadas ainda precisam de validacao propria; nao confundir cobertura HTTP com homologacao visual.

O teste configura um Superadmin ficticio `qa-staging`. Sua senha e derivada unidirecionalmente do segredo staging, com contexto exclusivo de QA, somente dentro do executor; nao aparece em codigo, artefatos ou logs. A troca desse token exige revisar o acesso QA, sem substituir automaticamente contas existentes. O segredo temporario de bootstrap e removido apos a instalacao QA. Nenhum Superadmin de producao e criado por esses scripts.

## Compilacao preventiva preservada

O workflow `verificar-projeto.yml` continua criando uma configuracao com UUID ficticio para `wrangler deploy --dry-run`. O workflow separado `homologar-staging.yml` usa `CLOUDFLARE_STAGING_TOKEN` para provisionar e testar exclusivamente o staging real.

A configuracao staging e construida por lista positiva. Bindings remotos extras, crons, routes e variaveis da producao sao descartados. O perfil inicial mantem funcoes desligadas; o perfil funcional explicito habilita jornadas, cadastro, recuperacao e batidas apenas apos validar nome, origem, conta e D1 de staging. Leads continuam desligados. O validador padrao ainda recusa flags habilitadas sem esse perfil explicito.

## Etapas restantes

1. Auditar integralmente tenant isolation das rotas habilitadas, dos endpoints legados e triggers SQL. Os testes existentes ainda nao substituem revisao e testes de penetracao.
2. Concluir a restauracao remota em banco novo e comparar schema, contagens, hashes e integridade referencial. Exportacao cifrada, descriptografia, SHA256, rejeicao de adulteracao e bookmark Time Travel ja foram executados; a primeira importacao remota falhou e permanece em investigacao.
3. Homologar interfaces, relatorios/exportacoes e configuracao de politicas sem fixtures SQL, alem dos fluxos HTTP aprovados.
4. Definir guarda operacional das chaves, retencao e backup de producao. O teste usa chave efemera e nao produz um backup operacional duradouro.
5. Obter aprovacao especifica antes de publicar em producao e definir as credenciais do primeiro Superadmin com o proprietario.

**Alvo conciliado em 2026-10-21:** o arquivo principal agora aponta para o Worker publico `gestor-ponto-multiempresa`, origem `https://gestor-ponto-multiempresa.netssh3-0.workers.dev` e banco D1 `cr-jornada-db`, conforme auditoria remota somente leitura. `scripts/verify-production-target.mjs` impede configuracoes divergentes, mas **nao autoriza deploy**. `scripts/preflight.mjs` continua bloqueando publicacao ate a revisao integral do isolamento multiempresa e homologacao.

## Permissoes

O token temporario `CLOUDFLARE_D1_SETUP_TOKEN` permanece sem uso. As escritas de homologacao utilizam somente `CLOUDFLARE_STAGING_TOKEN`; a conta e os destinos sao verificados antes de cada operacao. Acesso a metadados de producao e somente leitura. O preflight de producao permanece bloqueado.
