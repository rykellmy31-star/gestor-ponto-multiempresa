# Testes e evidências — 15/10/2026

## Resultado verificado

**90 cenários automatizados aprovados**, além de verificações complementares de PDFs, reinício e instalação nova:

| Camada | Resultado | Evidência gerada |
|---|---:|---|
| Cálculo, datas, validação e criptografia | **33/33** | `test-results/unit.json` |
| API real em Workers local/workerd + D1 | **31/31** | `test-results/integration.json` |
| Navegador Chromium, desktop e celular | **12/12** | `test-results/browser.json` e screenshots |
| Concorrência, segurança adicional e ferramentas operacionais | **14/14** | `test-results/edge-cases.json` |
| TypeScript estrito da aplicação e dos testes | **PASS** | `build.txt`, `typecheck-tests.txt` |
| Vite + empacotamento Worker de produção | **PASS — dry-run, sem publicar** | `build.txt` |
| Inspeção de PDFs reais com PyMuPDF | **4/4** | `pdf-validation.json` |
| Persistência após parar e iniciar novo processo workerd | **PASS** | `persistence.json` |
| Instalação nova a partir só de fonte pública | **PASS** | `clean-install.json`, `clean-install.txt` |
| Auditoria npm das dependências de produção | **0 vulnerabilidades reportadas** | `docs/dependency-audit-production.json` |
| Preflight com a configuração placeholder original | **Publicação corretamente bloqueada** | `preflight.txt` |

Relatórios de testes são evidências funcionais do momento da execução, não certificação de segurança, conformidade trabalhista ou desempenho em produção. A auditoria npm é das dependências **de produção**, não uma afirmação sobre toda ferramenta de desenvolvimento ou vulnerabilidades futuras.

Os testes usam pessoas e marcações **identificadas como fixtures de um banco isolado**. Esses dados não foram inseridos na instalação principal e não acompanham o banco da entrega. O pacote inclui código/testes e evidências selecionadas em `docs/evidencias/`, mas não bancos, contextos privados ou senhas. Caminhos `test-results/` nos JSONs indicam os arquivos originais gerados durante a execução.

## O que foi exercitado

### Unitários

Intervalo pago/não pago, aprovação/recusa/parcialidade de extra, tolerâncias por marcação/dia, faltas, abonos, folgas/feriados, dia futuro e em andamento, ausência de marcas, arredondamento preservando UTC original, totais acima de 24h, virada noturna/mensal, calendário de 28/29/30/31 dias, DST histórico, CPF, scrypt com salt/pepper e cifra com IV independente. Política de banco não aprova positivas pendentes por si só.

### Integração real

Setup protegido e sem senha padrão; login válido/inválido; autorização por perfil, CSRF e IDOR; CRUD, namespace exclusivo de identificadores e CPF cifrado; quatro pontos no servidor e retries; consulta independente ao SQLite persistente; imutabilidade por triggers; ajuste com motivo; análise de extra; abonos/justificativas; feriado; relatório semanal/mensal; turno atravessando o mês; PDF/CSV; fechamento, reabertura, versões e congelamento de identificação; recuperação de uso único/expiração; bloqueio/reativação; prazo absoluto e inatividade; reautenticação; throttle; administradores; auditoria e logout.

Erros SQLite `raw_punch_immutable` / `audit_immutable` impressos nos testes são **recusas esperadas** dentro de `assert.throws`, não falhas do relatório final.

### Navegador

Formulários e botões realmente acionam a API. Foram exercitados criação/edição persistente de pessoa/jornada, troca obrigatória de senha, XSS tratado como texto, sequência dos quatro botões, perda simulada da resposta **depois** de gravar e confirmação idempotente, solicitação/revisão assistida de senha, logout, exportações reais e impressão A4. Desktop 1440px e viewport móvel 390×844; página sem overflow horizontal indevido e sem exceções JavaScript não tratadas.

Um ensaio excedeu a memória do ambiente de 2GB e o kernel encerrou o Chromium. O harness foi ajustado para reutilizar o contexto móvel e liberar páginas ociosas; o bundle pré-construído foi usado nos servidores locais. **A repetição completa final passou**, sem novo OOM. Isso não é um teste de carga do produto: para desenvolvimento/testes com compiladores e navegadores simultâneos, prefira pelo menos 4GB de RAM ou os comandos de bundle abaixo.

### Casos adicionais

Primeira entrada simultânea com somente um dia/uma marca; duas tentativas de fechamento com somente uma nova versão; colisão de matrícula/login atômica; vigências históricas/futuras; futuro/ordem inválida em ajuste; bloqueio do ponto comum após tratamento; defesa contra fórmula CSV; sessão antiga com auth_version incompatível; recuperação administrativa pela CLI; paginação de 260 eventos empatados no mesmo milissegundo sem perda; revogação global com incremento de versão; backup AES-GCM, restauração em outro SQLite com triggers/FKs e recusa de frase incorreta.

### PDF e persistência

Os quatro PDFs reais foram analisados: A4 paisagem, todas as datas do mês, assinaturas, totais e nenhum span de texto fora da página. O PDF com justificativa de cerca de 2 mil caracteres preserva o marcador final e registros originais de ajuste no anexo, com saldo negativo legível. As imagens renderizadas foram inspecionadas visualmente.

No ensaio de reinício, as contagens de 5 funcionários, 9 marcas originais, 6 dias, 6 ajustes, 3 snapshots e 351 eventos permaneceram idênticas antes/depois da parada/inicialização do Worker. A API ainda exibiu as quatro marcas do funcionário de navegador e o fechamento v2 preservado. Esses são **números do banco de teste**, não da empresa do usuário. A instalação principal permaneceu com zero funcionários e zero pontos.

Uma cópia nova sem `.dev.vars`, bancos ou `node_modules` passou por `npm ci`, geração de novos segredos sem eco, migrations de dois bancos locais vazios, 33 unitários e build completo. A cópia temporária foi removida após a validação.

## Como reproduzir com segurança

**Use uma cópia local nova do código, nunca um banco de operação real.** O harness de navegador inclui uma checagem da instalação principal vazia. Requisitos: Node 22.13+, npm e **Python 3** para a verificação independente do SQLite; Chromium/Playwright e dependências Linux para testes de navegador.

1. Instale e prepare localmente:

```bash
npm ci
npm run secrets:local
npm run db:local
npm run build
npx playwright install --with-deps chromium
npm test
npm run typecheck:tests
```

O `--with-deps` pode precisar de privilégios de instalação do sistema no Linux. Não é requisito de execução do Worker em produção.

2. Sem servidor na porta 8788, prepare o banco **isolado**:

```bash
npm run test:prepare
```

Este comando recria **somente `.test-data`**, não `.data`/D1 remoto. Agora ele recusa a preparação se a porta 8788 estiver em uso, antes de apagar qualquer arquivo. `wrangler.test.jsonc` e credenciais aleatórias privadas são gerados automaticamente e ignorados no repositório.

3. Em dois terminais, inicie a instalação principal e o servidor isolado. Para economizar RAM, use o build já feito:

```bash
# Terminal A
npm run dev:bundle

# Terminal B
npm run test:serve:bundle
```

Alternativas com compilação/watch: `npm run dev` e `npm run test:serve`. Se mudar frontend ou Worker, pare os servidores, reconstrua e inicie novamente para não usar manifesto de assets antigo.

4. Num terceiro terminal, **nesta ordem**, contra 8788:

```bash
npm run test:integration
npm run test:browser
npm run test:edge
```

Não repita os testes destrutivos sobre as mesmas fixtures já preenchidas: pare o servidor, rode a preparação e refaça a sequência. O teste de primeira instalação pressupõe banco novo. Um `EDGE_FILTER` existe somente para depuração de cenário isolado; não equivale a uma aprovação da suíte inteira.

5. Validação adicional de PDFs (opcional para desenvolver, executada na entrega):

```bash
python3 -m pip install pymupdf
python3 tests/validate-pdf.py
```

6. Persistência por reinício real:

```bash
npm run test:restart -- --before
# Pare o servidor B, sem apagar .test-data ou rodar test:prepare.
# Inicie novamente o mesmo servidor B.
npm run test:restart
```

Depois pare o servidor de testes; ele não é o acesso da equipe. Preserve evidências que precisar, e não distribua `.test-data/context.json`, SQL descriptografado, `.dev.vars` ou backups com sua frase.

## Ainda obrigatório fora deste ambiente

**Não executados:** criação/publicação em conta Cloudflare, DNS/TLS/cookies e segurança no edge remoto, persistência em um redeploy **remoto**, Time Travel/importação em D1 remoto, entregabilidade de e-mail, carga real, pentest externo, dispositivos iOS/Android/Safari/Firefox reais e avaliação jurídico-trabalhista/REP-P. Siga o checklist de [PUBLICACAO.md](PUBLICACAO.md); não interprete `--dry-run` ou a prévia como comprovação desses pontos.
