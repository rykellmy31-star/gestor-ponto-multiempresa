# Publicação Cloudflare — passo a passo

**Nenhum recurso remoto foi criado nesta entrega.** Não foram fornecidas credenciais da sua conta, e o conector Cloudflare não está disponível neste ambiente. Faça a autorização no **seu computador/terminal privado**; não envie tokens, senhas ou chaves no chat.

## 1. Conta e ferramentas

1. Tenha Node.js **22.13 ou superior** e npm. Confira com `node --version`.
2. Extraia o código e, dentro da pasta do projeto, execute `npm ci`.
3. Recomendação operacional: ative **Workers Paid**, porque o hash de senha scrypt e a geração de PDF exigem mais CPU que a pequena franquia por requisição do plano gratuito. Preços, quotas e cobrança devem ser confirmados no painel; a entrega não inclui crédito Cloudflare.
4. Autorize a CLI: `npx wrangler login`. Uma janela oficial Cloudflare solicitará sua autorização. Depois execute `npx wrangler whoami` e confira a conta.
5. Se participar de mais de uma conta, configure o `account_id` correto no `wrangler.jsonc`. Nunca confunda o banco de homologação com o de produção.

## 2. Criar D1 e configurar o vínculo

No terminal autorizado:

```bash
npx wrangler d1 create jornada-db
```

O comando retorna um `database_id` real. Substitua **apenas o placeholder** no bloco `d1_databases` do `wrangler.jsonc`:

```json
{
  "binding": "DB",
  "database_name": "jornada-db",
  "database_id": "COLE_AQUI_O_ID_REAL_RETORNADO",
  "migrations_dir": "migrations"
}
```

Esse ID é um identificador de recurso, não uma senha. Não use o texto acima como ID. Se o nome escolhido for outro, ajuste também `database_name`.

Alternativa pelo painel: **Storage & databases → D1 SQL Database → Create database**; nomeie o banco, abra-o e copie o Database ID. A vinculação será criada pelo Wrangler a partir do arquivo de configuração. Não publique sem a binding **DB**.

Aplique o esquema **no banco remoto recém-criado**:

```bash
npm run db:remote
```

Confirme explicitamente no prompt da CLI. As migrations `0001_initial.sql` e `0002_auth_versions.sql` são necessárias. Não rode a preparação de testes contra o banco remoto.

## 3. Definir uma única origem HTTPS

Edite `vars` no `wrangler.jsonc`, preservando `ENVIRONMENT: "production"`:

```json
"vars": {
  "ENVIRONMENT": "production",
  "APP_ORIGIN": "https://ponto.suaempresa.com.br",
  "SESSION_HOURS": "8"
}
```

**Troque o domínio de exemplo por um domínio seu.** Sem barra final, caminho, query ou HTTP. O preflight e o Worker bloqueiam a origem `.invalid` original. Não habilite `development` para contornar erros em produção: isso enfraqueceria cookies, política de origem e headers.

### Com domínio próprio (recomendado)

- A zona DNS deve estar ativa na Cloudflare.
- Acrescente no nível principal do `wrangler.jsonc`, com o domínio real:
  `"routes": [{"pattern":"ponto.suaempresa.com.br","custom_domain":true}]`.
- Isso permite ao deploy criar a associação. Alternativamente, após publicar: **Workers & Pages → jornada-ponto → Settings → Domains & Routes → Add → Custom Domain**, informe o domínio e confirme.
- Use TLS e confira certificado e DNS. A aplicação redireciona navegações feitas por outra origem para a origem canônica; as operações de API só aceitam a origem configurada.

### Sem domínio próprio — workers.dev

No painel, consulte/configure seu subdomínio em **Workers & Pages** e use o endereço **real** atribuído ao Worker, por exemplo o formato `https://NOME-DO-WORKER.SUBDOMINIO-DA-CONTA.workers.dev`. Esse texto é apenas um formato, não uma URL entregue. Defina `APP_ORIGIN` exatamente como o endereço exibido na sua conta antes do uso. Caso tenha feito um primeiro deploy para obter o endereço, corrija `APP_ORIGIN` e republique antes de instalar/cadastrar pessoas.

Não alterne o uso entre workers.dev e domínio próprio. Cookies `__Host-` pertencem a uma origem. Links de recuperação também usam a origem canônica.

## 4. Gerar e instalar os três Secrets

No seu cofre de senhas, gere **três valores independentes de 32 bytes/64 caracteres hexadecimais**, com gerador criptográfico. Alternativamente, no **seu terminal privado**, gere um por vez:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde os três valores identificados em cofre separado do banco. Instale-os pelo prompt privado:

```bash
npx wrangler secret put AUTH_PEPPER
npx wrangler secret put DATA_KEY
npx wrangler secret put BOOTSTRAP_TOKEN
```

- `AUTH_PEPPER`: necessário para verificar senhas e hashes de controle.
- `DATA_KEY`: necessário para descriptografar CPFs.
- `BOOTSTRAP_TOKEN`: acesso restrito à criação do primeiro administrador; remova-o após a instalação.

Nunca coloque esses valores em `vars`, React, Vite `VITE_*`, arquivos públicos, repositório ou mensagens. Não reutilize os segredos locais/de teste em produção. `npx wrangler secret list` mostra **nomes**, não os valores: confira os três nomes na conta correta.

Alternativa no painel: **Worker → Settings → Variables and Secrets → Add**, tipo **Secret**, para cada nome. Mantenha `APP_ORIGIN` e `ENVIRONMENT` como variáveis comuns, sem duplicar nomes de Secrets.

## 5. Construir e publicar

```bash
npm test
npm run build
npm run deploy
```

`build` executa uma simulação (`wrangler deploy --dry-run`), **não uma publicação**. `deploy` reconstrói, executa `scripts/preflight.mjs` e só então chama `wrangler deploy` de verdade. O preflight valida configuração estática e procura vazamento dos segredos locais nos arquivos públicos; ele não comprova que sua conta, os Secrets remotos ou o DNS estão corretos. Confira a saída da CLI e a versão/URL no painel.

Preserve estes itens: `nodejs_compat`, assets binding **ASSETS**, D1 binding **DB**, `assets.run_worker_first: true`, SPA fallback e suporte a `.ttf`. Não exponha o frontend separado sem os guardas do Worker. Não é preciso criar um projeto Pages: um único Worker atende UI, API e arquivos estáticos.

## 6. Instalação e retirada do segredo inicial

1. Abra `https://SEU_DOMINIO_REAL/setup`.
2. Informe **seu** BOOTSTRAP_TOKEN, empresa, fuso America/Bahia ou America/Sao_Paulo, nome, usuário e senha forte do administrador.
3. Entre em `/admin/entrar` e confira a empresa.
4. Remova imediatamente o segredo temporário:
   `npx wrangler secret delete BOOTSTRAP_TOKEN`.
5. Confirme que `/setup` não permite uma nova instalação. A trava também está no D1; não é apenas um botão escondido.
6. Cadastre uma jornada e um funcionário de homologação com dados autorizados, não pessoas fictícias misturadas à operação real.

Não existe usuário/senha padrão e não há registro público de novos administradores. Novos administradores são autorizados por outro administrador reautenticado.

## 7. Teste obrigatório na conta real, antes de operar

- [ ] Confirme `ENVIRONMENT=production`, `APP_ORIGIN` HTTPS real e Secrets corretos.
- [ ] Acesse `/admin`, `/app` e APIs sem cookies: redirecionamento/401, nunca dados privados.
- [ ] No navegador, confira cookies `__Host-jornada_admin`/`__Host-jornada_employee`, **Secure**, HttpOnly, SameSite=Strict.
- [ ] Confira CSP, `Cache-Control: no-store, private`, nosniff, HSTS e X-Frame-Options nas páginas privadas/respostas de API. A prévia local não é comprovação desses headers no edge remoto.
- [ ] Faça login, troque a senha inicial, complete quatro registros e tente repetir uma tentativa; confira o D1 e o relatório.
- [ ] Funcionário não acessa painel/dados de outro funcionário, inclusive com ID digitado manualmente na API.
- [ ] Confira fuso, data local e um turno noturno de homologação.
- [ ] Exporte PDF/CSV e imprima A4. Feche/reabra com motivo.
- [ ] Teste recuperação assistida, logout, invalidação de sessão e bloqueio de conta.
- [ ] Crie backup cifrado **remoto** e restaure em outro D1 vazio; confira integridade e chaves.
- [ ] Faça novo deploy sem apagar banco e confirme que registros anteriores continuam presentes.
- [ ] Teste nos dispositivos reais da equipe e faça teste de carga compatível com seu volume.

**Esses testes remotos não foram executados nesta entrega.** O código tem testes locais automatizados; DNS, TLS, região do D1, quotas, faturamento, recuperação Time Travel e e-mail dependem da sua conta.

## 8. Atualizar sem perder o ponto

1. Planeje janela fora de entradas/saídas; faça backup cifrado remoto e registre um bookmark Time Travel.
2. Guarde código/lockfile da versão anterior e confira mudanças de migrations.
3. `npm ci`; `npm test`; `npm run build`.
4. `npm run db:remote` apenas para migrations novas revisadas; depois `npm run deploy`.
5. Faça os smoke tests acima e confira registros anteriores. **Não** delete/recrie D1, não limpe `.data` e não regenere `AUTH_PEPPER`/`DATA_KEY`.
6. Rollback do Worker pode ser feito no painel em **Deployments** ou pelo Wrangler; rollback de código não desfaz migrations. Uma recuperação de banco é uma operação diferente e deve ser planejada, conforme [BACKUP-RECUPERACAO.md](BACKUP-RECUPERACAO.md).

Referências oficiais: [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [Node crypto no Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
