# CR JORNADA — protocolo de homologação

Este documento prepara a revisão. Não autoriza deploy, migração remota,
provisionamento, ativação de flags ou alteração da Farmácia Pague Pouco.

## Verificações locais e CI

Executar no diretório raiz, com Node 22.13+ e dependências do lockfile:

```sh
npm ci
npm run typecheck
npm run typecheck:tests
npx vitest run --exclude 'tests/d1-*.test.ts' --no-file-parallelism --maxWorkers=2
npx vitest run tests/d1- --shard=1/3 --no-file-parallelism --maxWorkers=1
npx vitest run tests/d1- --shard=2/3 --no-file-parallelism --maxWorkers=1
npx vitest run tests/d1- --shard=3/3 --no-file-parallelism --maxWorkers=1
npm run build:web
npx wrangler deploy --dry-run --outdir .worker-bundle
```

O último comando somente compila. Não executar `npm run deploy`, `db:remote`,
`wrangler deploy` sem `--dry-run` ou comandos com `--remote` nesta revisão.
Os testes Wrangler D1 usam `--local` e diretórios temporários próprios.
Os novos testes Miniflare usam banco efêmero, sem configuração ou acesso remoto.

Conferir no PR o SHA do último commit, todos os jobs e o fim completo da execução.
Não interpretar job cancelado, teste parcial ou execução anterior como aprovação.

## Matriz funcional para ambiente isolado autorizado

Usar duas empresas fictícias A/B, dois gestores e dois funcionários fictícios,
sem dados reais. Cada cenário deve registrar resultado esperado e obtido.

| Fluxo | Critério de aprovação |
| --- | --- |
| Sessões | Cookie HttpOnly, escopo correto, expiração e revogação; sem token/hash na resposta pública |
| Gestor com senha inicial | Somente sessão, saída e troca de senha; bloqueio inclusive de consultas empresariais |
| Recuperação assistida | Somente Superadmin + CSRF; senha provisória exibida uma vez, sem segredo em logs/auditoria |
| Expiração provisória | Negar login/sessão no instante limite; troca bem-sucedida remove prazo e exige novo login |
| Concorrência de senha | Segundo reset/troca concorrente falha sem gravar auditoria ou revogar sessões adicionais |
| Concorrência de login | Suspensão, desativação, reset ou expiração entre verificação e INSERT impedem cookie |
| Empresa suspensa | Sessões emitidas antes da suspensão deixam de autorizar operações |
| Vínculos CPF | Seleção somente entre empresas realmente vinculadas; IDs de B não acessíveis pela sessão A |
| Jornadas | Segunda a sexta em grupo; sábado com horários próprios; atribuição cruzada A/B rejeitada |
| Datas de jornada | Dia sem expediente, data inválida, atribuição futura e histórico anterior preservados |
| Ponto fechado | Flag ausente ou política desabilitada nega escrita; rotas antigas permanecem bloqueadas |
| Ponto liberado só no staging autorizado | Hora do servidor, CSRF, ordem e idempotência; repetição não duplica marcação |
| Histórico | Somente dias do funcionário e empresa autenticados; dias legados não reconciliados invisíveis |
| CSV pessoal | Mesmo mês exibido, sem exportação durante erro/carregamento, horário local e UTC corretos |
| CSV em planilha | UTF-8, acentos, aspas e separadores corretos; fórmulas neutralizadas |
| Interface | Desktop e celular; navegação por teclado, mensagens de erro, sessão vencida, download |
| Backup/rollback | Restaurar cópia fictícia em banco separado e conferir integridade e isolamento |

## Limites e decisões pendentes

Jornadas noturnas/virada de data, ajustes, fechamento, relatórios consolidados e
comprovantes oficiais exigem trabalho adicional. Não apresentar o CSV como
comprovante trabalhista ou cálculo de folha. Recuperação automática por email,
canal de entrega das senhas, política comercial e requisitos regulatórios precisam
de definição e homologação. Nunca pedir que credenciais sejam coladas no PR.

As migrações devem ser revisadas e ensaiadas em cópia isolada. A reconciliação dos
dados antigos é um procedimento separado; passar testes de instalação limpa não
prova que uma base real pode ser migrada com segurança.
