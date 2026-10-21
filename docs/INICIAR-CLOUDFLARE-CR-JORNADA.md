# CR JORNADA — criar Cloudflare sem risco ao ambiente de produção

> Referência para a versão multiempresa em `desenvolvimento-cr-jornada`. Este guia **não autoriza** migrações no D1 atual, ativação de funcionalidades de ponto, deploy de produção ou contratação de plano pago. Use apenas dados fictícios em homologação.

## Escolha do serviço

O produto funciona como **um Cloudflare Worker**, não como um Pages estático: o mesmo Worker serve React em `ASSETS`, a API Hono e o banco D1 com binding `DB`. Não é necessário criar projeto Pages para o produto funcional. Há uma demonstração visual histórica em Pages que não substitui o Worker.

No painel Cloudflare, acesse **Workers & Pages → Create application** e escolha um Worker. Para um primeiro teste, utilize **um nome exclusivo**, como `cr-jornada-staging`. Evite conectar o repositório ao **deploy automático de produção** antes da homologação: a integração Git do Workers Builds faz deploy com o comando padrão `npx wrangler deploy`, que **não executa** o bloqueio em `scripts/preflight.mjs`. Nenhuma execução de GitHub Actions neste repositório faz deploy remoto.

## Separação obrigatória dos bancos

A configuração versionada `wrangler.jsonc` já contém um nome de Worker, uma origem e um `database_id` D1. **Isso não comprova que o recurso remoto exista, nem autoriza recriá-lo, substituí-lo ou migrá-lo.** Confira no painel antes de qualquer decisão. Não conecte esse banco ao staging.

Para homologação, crie um D1 **novo e vazio**, por exemplo `cr-jornada-staging-db`, e guarde seu ID de recurso (não é segredo). O estágio deve usar a binding chamada exatamente `DB`. Não execute `npm run db:remote` com `wrangler.jsonc` de produção.

## Gerar configuração local segura, após criar Worker e D1 staging

Em um clone local do repositório, após confirmar o nome, o ID D1 e o domínio `workers.dev` *reais* do staging:

```bash
npm run cloudflare:prepare-staging -- --worker cr-jornada-staging --database cr-jornada-staging-db --database-id ID_UUID_D1_STAGING_REAL --origin https://DOMINIO_REAL_DO_STAGING.workers.dev
```

O script:
- cria `wrangler.staging.jsonc` local, ignorado pelo Git, e **recusa sobrescrever** um arquivo existente;
- recusa usar o mesmo ID D1 ou `APP_ORIGIN` da configuração base;
- mantém `ENVIRONMENT=production` para exigir cookies Secure, CSRF, cabeçalhos e proteção de origem também no staging;
- desativa por padrão os módulos de jornada empresarial, cadastro, recuperação, batida e leads;
- remove domínios/rotas de produção e o cron herdado;
- **não cria D1, não migra banco, não executa deploy, não guarda Secrets e não gera gastos**.

Apenas para conferir a compilação da configuração de staging **sem publicar**:

```bash
npm ci
npm run build:web
npx wrangler deploy --dry-run --config wrangler.staging.jsonc
```

## Quando houver conexão autorizada para homologação

Separadamente do desenvolvimento, um operador da conta deve confirmar a titularidade e, sem divulgar valores, configurar no Worker **de staging** os Secrets `AUTH_PEPPER`, `DATA_KEY`, `PLATFORM_BOOTSTRAP_TOKEN` e `CPF_LOOKUP_SECRET`. Os valores devem ser aleatórios, independentes entre ambientes e mantidos num cofre, nunca neste chat, em Git ou em variáveis públicas da interface.

Depois de revisar as migrações, testar instalações locais e confirmar que o D1 staging é **diferente** do banco existente, poderá ser planejada a aplicação das migrações **apenas no staging**. O cadastro de Superadmin multiempresa é feito por `POST /api/platform/setup` (não pelo fluxo legado `/setup` de outro sistema). Não crie senhas fixas nem CPFs verdadeiros de teste.

Antes de publicar a aplicação para clientes, ainda faltam a homologação no Worker real, revisão das rotas legadas, teste de backup/restauração no D1 isolado, validação de disponibilidade e requisitos legais para registro oficial de ponto no Brasil. **O projeto atualmente bloqueia publicação por `npm run deploy` de propósito; não contorne o bloqueio usando `wrangler deploy` direto em produção.**

Referências: [Homologação](HOMOLOGACAO-CR-JORNADA.md), [Ambientes](AMBIENTES-CR-JORNADA.md), [Backup](BACKUP-RECUPERACAO.md), [documentação Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) e [documentação D1](https://developers.cloudflare.com/d1/wrangler-commands/).
