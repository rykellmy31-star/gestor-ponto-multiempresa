# CR JORNADA — inicializar esquema D1 existente

Diagnostico real: o Worker gestor-ponto-multiempresa aponta para cr-jornada-db.
O banco contem apenas a tabela _cf_KV e ainda nao possui as tabelas do Superadmin.
Este procedimento instala o esquema do CR JORNADA sem criar nem apagar um D1.

## Autorizacao necessaria no Safari

1. Cloudflare: criar **novo token temporario** com permissao **Account → D1 → Edit**, restrito a conta deste projeto, sem Workers Scripts Edit, DNS ou outras contas.
2. GitHub [Actions secrets](https://github.com/rykellmy31-star/gestor-ponto-multiempresa/settings/secrets/actions): criar **Repository secret** `CLOUDFLARE_D1_SETUP_TOKEN` com o valor do token (nao enviar pelo chat).
3. Depois de aprovar explicitamente instalar as 38 migrations no D1 `cr-jornada-db`, criar **Repository variable** `CLOUDFLARE_D1_INIT_APPROVAL` com o valor exato `INSTALAR-CR-JORNADA-D1-APOS-BACKUP`.
4. Informar ao ChatGPT somente que as duas configuracoes estao prontas. A proxima alteracao revisada enviada para `desenvolvimento-cr-jornada` iniciara o CI. O job de inicializacao somente roda depois dos 4 testes locais aprovados.
5. O job exige: ID do D1 exato, Worker vinculado corretamente, nenhuma tabela de negocio, bookmark Time Travel valido; depois aplica `wrangler d1 migrations apply DB --remote`.
6. Apos confirmacao, **remover** a variable de aprovacao e **revogar** o token D1 Edit.

**Nao publica Worker, nao cadastra Superadmin, nao apaga dados e nao altera main.**

O token de auditoria anterior possui somente leitura e nao pode executar migrations. 
O Time Travel permite recuperacao por bookmark; restaurar producao seria destrutivo e nao faz parte do job.
Os testes D1 locais nao substituem backup cifrado externo e ensaio de restauracao.

Fonte Cloudflare: https://developers.cloudflare.com/d1/wrangler-commands/ e https://developers.cloudflare.com/d1/reference/time-travel/