# CR JORNADA — homologacao staging isolada

O banco de producao **cr-jornada-db** ja recebeu 38 migrations em 2026-10-21. A instalacao foi encerrada e o job remoto de inicializacao foi desativado. **Nao recriar ou aplicar migrations no banco de producao durante a homologacao.**

## Apuração e logins visuais — rodada atual

Actions `39674118629`, código `ead8fd018ae563cca951fe3f3e5dfefb7539e613`: **sucesso integral**, 230 verificações HTTP/navegador. Apuração provisória por empresa com snapshots, consulta mensal e CSV aprovados nas empresas A/B. Login Superadmin e visualização das empresas aprovados. Funcionário autenticou pelo formulário, escolheu cada empresa do CPF, visualizou a jornada concluída e baixou seu extrato, com quatro registros próprios. Os rótulos de CPF e senha foram associados explicitamente aos campos.

A apuração identifica dias sem histórico suficiente para conferência, sem faltas presumidas. Não é fechamento definitivo: calendário/ocorrências por empresa, conciliação de legado, ajustes e fechamento ainda exigem entrega própria. Detalhes em `APURACAO-EMPRESARIAL-PROVISORIA.md`. O teste inicial de apuração `39673853923` também passou, com 223 verificações.

Recuperação remota novamente aprovada: 52 tabelas, schema e hashes de conteúdo idênticos, integridade referencial, AES-256-GCM/SHA256 e adulteração aprovados. Destino `cr-jornada-staging-restore-02b3d3191742`, ID `6b33fe89-5993-409b-be88-2c1c7d5b6212`. Staging conserva 39 migrations; produção conserva 38 e não foi exportada, migrada ou restaurada.

## Políticas pelo painel — rodada anterior

Actions `39671265454`, código `9808e88d5b1848902e816cba4a52d5d64df8c091`: **sucesso integral**, 202 verificações HTTP/navegador, políticas de ponto configuradas pela interface nas duas empresas, controle de revisão, auditoria e preservação das regras congeladas após alteração durante o dia. Não há mais fixture SQL para criar políticas neste teste.

O mesmo Worker e o mesmo D1 staging agora têm **39 migrations**. Produção conserva **38**. As migrations 0001–0038 não foram editadas. A nova 0039 é aditiva e permanece pendente de revisão/autorização para produção.

Recuperação também aprovada na rodada: 52 tabelas de aplicação/migrations, schema e hashes de conteúdo idênticos, integridade referencial e AES-256-GCM/SHA256/adulteração aprovados. Destino separado: `cr-jornada-staging-restore-f0d50ccd371c`, ID `d42feab3-ffa3-4ff3-822b-336fec9adb94`. Produção não foi exportada nem restaurada. Detalhes em `POLITICAS-PONTO-EMPRESARIAIS.md`.

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

Nas rodadas históricas até `39669565281`, as políticas eram fixtures SQL. A rodada atual `39671265454` substituiu essa preparação pela configuração no painel real. A rodada complementar abaixo homologa o login empresarial e o relatório de marcações com CSV pelo navegador. Os demais fluxos de interface, cálculos empresariais e rotas legadas ainda precisam de validação própria; não confundir cobertura HTTP com homologação visual.

O teste configura um Superadmin ficticio `qa-staging`. Sua senha e derivada unidirecionalmente do segredo staging, com contexto exclusivo de QA, somente dentro do executor; nao aparece em codigo, artefatos ou logs. A troca desse token exige revisar o acesso QA, sem substituir automaticamente contas existentes. O segredo temporario de bootstrap e removido apos a instalacao QA. Nenhum Superadmin de producao e criado por esses scripts.

## Relatórios e navegador real — rodada complementar

Actions `39669565281`, commit `b8894153b0b106a550538bbed32b09b7b4de8021`: **sucesso integral**. Foram **179 verificações** do fluxo HTTP e navegador: autenticação empresarial pelo formulário real, relatório mensal de marcações por funcionário e download CSV nas empresas A/B, quatro comprovantes em cada relatório, isolamento por empresa e bloqueio após suspensão. A primeira tentativa `39668871759` havia passado na API/CSV e falhado na seleção do filtro no navegador; os rótulos foram associados explicitamente aos campos e o teste passou a usar o formulário real de login.

A recuperação da mesma rodada também passou: clone separado `cr-jornada-staging-restore-c1625a77e900`, ID `54214342-1417-47c2-8949-017e816297d3`; 51 tabelas, schema e hashes de conteúdo idênticos, SHA256/AES-256-GCM/adulteração e integridade referencial aprovados. Não foi produzido backup operacional de produção.

Detalhes, controles e limites em `RELATORIO-MARCACOES-EMPRESARIAL.md`. Este relatório de marcações não substitui o cálculo de folha, faltas, atrasos ou saldo. A configuração de políticas pelo painel foi homologada na rodada atual acima. A homologação visual dos demais fluxos continua pendente.

## Compilacao preventiva preservada

O workflow `verificar-projeto.yml` continua criando uma configuracao com UUID ficticio para `wrangler deploy --dry-run`. O workflow separado `homologar-staging.yml` usa `CLOUDFLARE_STAGING_TOKEN` para provisionar e testar exclusivamente o staging real.

Em pushes de interface ou rotas, `homologar-staging.yml` valida os fluxos reais sem criar mais um clone D1. A recuperação cifrada roda pelo workflow dedicado `recuperar-staging.yml` quando seus scripts mudam ou por acionamento manual; o despacho manual de `homologar-staging.yml` também inclui a recuperação. A prova anterior de 52 tabelas permanece registrada, e nenhum backup efêmero é tratado como cópia operacional.

A configuracao staging e construida por lista positiva. Bindings remotos extras, crons, routes e variaveis da producao sao descartados. O perfil inicial mantem funcoes desligadas; o perfil funcional explicito habilita jornadas, cadastro, recuperacao e batidas apenas apos validar nome, origem, conta e D1 de staging. Leads continuam desligados. O validador padrao ainda recusa flags habilitadas sem esse perfil explicito.

## Etapas restantes

1. Auditar integralmente tenant isolation das rotas habilitadas, dos endpoints legados e triggers SQL. Os testes existentes ainda nao substituem revisao e testes de penetracao.
2. Manter a prova de recuperacao aprovada: `recuperar-staging.yml` permite repetir o ensaio sem executar novamente os fluxos HTTP. Destinos existentes so sao reutilizados quando comprovadamente vazios; nunca limpar ou sobrescrever uma restauracao parcial/completa automaticamente.
3. Homologar os demais formulários de todos os perfis e os cálculos empresariais completos. Login empresarial, políticas e relatório de marcações/CSV já passaram pelo navegador real.
4. Definir guarda operacional das chaves, retencao e backup de producao. O teste usa chave efemera e nao produz um backup operacional duradouro.
5. Obter aprovacao especifica antes de publicar em producao e definir as credenciais do primeiro Superadmin com o proprietario.

**Alvo conciliado em 2026-10-21:** o arquivo principal agora aponta para o Worker publico `gestor-ponto-multiempresa`, origem `https://gestor-ponto-multiempresa.netssh3-0.workers.dev` e banco D1 `cr-jornada-db`, conforme auditoria remota somente leitura. `scripts/verify-production-target.mjs` impede configuracoes divergentes, mas **nao autoriza deploy**. `scripts/preflight.mjs` continua bloqueando publicacao ate a revisao integral do isolamento multiempresa e homologacao.

## Permissoes

O token temporario `CLOUDFLARE_D1_SETUP_TOKEN` permanece sem uso. As escritas de homologacao utilizam somente `CLOUDFLARE_STAGING_TOKEN`; a conta e os destinos sao verificados antes de cada operacao. Acesso a metadados de producao e somente leitura. O preflight de producao permanece bloqueado.
