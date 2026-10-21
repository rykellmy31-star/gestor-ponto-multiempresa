# CR JORNADA — homologacao staging isolada

O banco de producao **cr-jornada-db** ja recebeu 38 migrations em 2026-10-21. A instalacao foi encerrada e o job remoto de inicializacao foi desativado. **Nao recriar ou aplicar migrations no banco de producao durante a homologacao.**

## Homologacao remota executada em 2026-10-21

- Worker: `gestor-ponto-multiempresa-staging`.
- Origem confirmada por health check HTTPS: `https://gestor-ponto-multiempresa-staging.netssh3-0.workers.dev`.
- D1: `cr-jornada-staging-db`, ID `41604781-5fbf-4287-beca-64e20ce1ee1f`.
- 38 migrations aplicadas no staging. Nenhuma migration de producao foi reexecutada.
- Secrets AUTH_PEPPER, DATA_KEY e CPF_LOOKUP_SECRET gerados exclusivamente para staging. Nenhuma chave de producao copiada.
- Infraestrutura aprovada no Actions `39659601404`, commit `0b67c58fa55eae04b0fca0802ef40d4b34ddebb8`.
- Fluxos HTTP reais: **158 verificacoes aprovadas**, incluindo pagina comercial, no Actions `39662655101`, commit `1c70fd50983faf494d7df105e9dc69701397b5f7`. A etapa HTTP passou; o job dessa rodada falhou depois na recuperacao, corrigida e aprovada separadamente abaixo.
- Recuperacao remota: **aprovada** no Actions `39666007053`, commit `7c47180043fa5be736f37cc8b931ebe3481e09e2`. Banco separado `cr-jornada-staging-restore-e37bdead2e50`, ID `f2f2decd-0cea-47eb-90b0-640cd9b69e9c`: **51 tabelas**, schema e hashes do conteudo identicos; `foreign_key_check` sem violacoes; manifesto SHA256, AES-256-GCM e rejeicao de adulteracao aprovados. Producao nao foi exportada nem restaurada.

`scripts/exercise-cloudflare-staging.mjs` exercita Superadmin, duas empresas ficticias, administradores com troca inicial de senha, cadastro de funcionarios, CPF com dois vinculos, isolamento de listas/historico, jornadas por dia, atribuicao em lote, repeticao idempotente, quatro batidas de ponto por funcionario e revogacao de sessoes ao suspender/reativar uma empresa.

As politicas de ponto das duas empresas sao fixtures inseridas diretamente no D1 staging pelo teste. Isso **nao comprova configuracao de politica pelo painel**. O fluxo de interface, relatorios empresariais/exportacoes e as rotas legadas ainda precisam de validacao propria; nao confundir cobertura HTTP com homologacao visual.

O teste configura um Superadmin ficticio `qa-staging`. Sua senha e derivada unidirecionalmente do segredo staging, com contexto exclusivo de QA, somente dentro do executor; nao aparece em codigo, artefatos ou logs. A troca desse token exige revisar o acesso QA, sem substituir automaticamente contas existentes. O segredo temporario de bootstrap e removido apos a instalacao QA. Nenhum Superadmin de producao e criado por esses scripts.

## Compilacao preventiva preservada

O workflow `verificar-projeto.yml` continua criando uma configuracao com UUID ficticio para `wrangler deploy --dry-run`. O workflow separado `homologar-staging.yml` usa `CLOUDFLARE_STAGING_TOKEN` para provisionar e testar exclusivamente o staging real.

A configuracao staging e construida por lista positiva. Bindings remotos extras, crons, routes e variaveis da producao sao descartados. O perfil inicial mantem funcoes desligadas; o perfil funcional explicito habilita jornadas, cadastro, recuperacao e batidas apenas apos validar nome, origem, conta e D1 de staging. Leads continuam desligados. O validador padrao ainda recusa flags habilitadas sem esse perfil explicito.

## Etapas restantes

1. Auditar integralmente tenant isolation das rotas habilitadas, dos endpoints legados e triggers SQL. Os testes existentes ainda nao substituem revisao e testes de penetracao.
2. Manter a prova de recuperacao aprovada: `recuperar-staging.yml` permite repetir o ensaio sem executar novamente os fluxos HTTP. Destinos existentes so sao reutilizados quando comprovadamente vazios; nunca limpar ou sobrescrever uma restauracao parcial/completa automaticamente.
3. Homologar interfaces, relatorios/exportacoes e configuracao de politicas sem fixtures SQL, alem dos fluxos HTTP aprovados.
4. Definir guarda operacional das chaves, retencao e backup de producao. O teste usa chave efemera e nao produz um backup operacional duradouro.
5. Obter aprovacao especifica antes de publicar em producao e definir as credenciais do primeiro Superadmin com o proprietario.

**Alvo conciliado em 2026-10-21:** o arquivo principal agora aponta para o Worker publico `gestor-ponto-multiempresa`, origem `https://gestor-ponto-multiempresa.netssh3-0.workers.dev` e banco D1 `cr-jornada-db`, conforme auditoria remota somente leitura. `scripts/verify-production-target.mjs` impede configuracoes divergentes, mas **nao autoriza deploy**. `scripts/preflight.mjs` continua bloqueando publicacao ate a revisao integral do isolamento multiempresa e homologacao.

## Permissoes

O token temporario `CLOUDFLARE_D1_SETUP_TOKEN` permanece sem uso. As escritas de homologacao utilizam somente `CLOUDFLARE_STAGING_TOKEN`; a conta e os destinos sao verificados antes de cada operacao. Acesso a metadados de producao e somente leitura. O preflight de producao permanece bloqueado.
