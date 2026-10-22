# Validação local sem disparar GitHub Actions

Por decisão do proprietário, os workflows da branch de desenvolvimento usam
somente `workflow_dispatch`. Não há gatilhos de push, Pull Request, agendamento
ou execução encadeada. Nenhum workflow manual deve ser iniciado pelo assistente
sem instrução específica futura do proprietário. Não habilitar cobrança,
orçamento, pagamento ou serviços pagos.

## Antes de enviar alterações

Usar as dependências do lockfile e executar neste ambiente de desenvolvimento:

```sh
npm run typecheck
npm run typecheck:tests
npx vitest run --exclude 'tests/d1-*.test.ts' --no-file-parallelism --maxWorkers=2
npm run build:web
npx wrangler deploy --dry-run --outdir .worker-bundle
```

Para mudanças de banco, autenticação ou isolamento, executar também os três
shards locais (podem rodar em paralelo, com diretórios de banco temporários):

```sh
npx vitest run tests/d1- --shard=1/3 --no-file-parallelism --maxWorkers=1
npx vitest run tests/d1- --shard=2/3 --no-file-parallelism --maxWorkers=1
npx vitest run tests/d1- --shard=3/3 --no-file-parallelism --maxWorkers=1
```

`npm audit --audit-level=moderate` consulta a auditoria de dependências, sem
contratar serviços. O dry-run compila o Worker, sem implantá-lo. Não executar
comandos de deploy real, migração remota, provisionamento ou alteração de segredos.

Registrar no PR comandos, resultados, limitações e commit correspondente.
Não declarar uma execução local como execução de Actions. Não reutilizar a
aprovação de um SHA antigo como se cobrisse alterações posteriores.

## Envio e integração

Usar exclusivamente `desenvolvimento-cr-jornada`. Commits enviados nesta política
incluem `[skip ci]` como proteção adicional durante a transição dos gatilhos.
A `main` não é alterada. O PR continua rascunho; testes locais não autorizam merge.

Antes de futura integração, repetir as verificações completas no estado exato
que será integrado e revisar as evidências. A validação manual completa do
workflow `Verificar CR JORNADA` continua disponível, selecionando explicitamente
a branch de desenvolvimento, mas sua execução pode consumir cota e não é
iniciada nesta política. O workflow de interface é opcional e repete parte das
checagens completas; não iniciar ambos por rotina.

A alteração dos gatilhos não altera proteções da branch ou configurações de
cobrança. Se uma regra existente exigir check do GitHub, manter o PR aberto até
uma decisão do proprietário; não remover nem contornar a exigência para mesclar.
