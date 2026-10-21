# CR JORNADA — autorizar auditoria Cloudflare sem login remoto

A conta Cloudflare do proprietario nao autenticou no navegador TinyFish por causa da verificacao de seguranca do provedor. **Nao tentar contornar essa verificacao.** A integracao oficial com GitHub Actions permite acesso via token restrito, sem enviar senha ou token ao ChatGPT.

## Etapa 1 — auditoria remota somente leitura

1. No Safari logado na Cloudflare, abra **Perfil → API Tokens → Create Token → Create Custom Token**.
2. Escolha nome temporario, por exemplo **CR Jornada auditoria D1 e Workers**.
3. Adicione **Account → D1 → Read** e **Account → Workers Scripts → Read** (a nomenclatura pode aparecer como Workers Scripts Read). Limite **Account Resources** à conta que contem o Worker e o banco do projeto. Nao conceda **Edit/Write**, permissao de DNS, token global nem acesso a todas as contas. Se possivel, configure uma expiracao curta.
4. Copie o token **para colar diretamente no GitHub**, sem mandar por chat.
5. Abra [Settings → Secrets and variables → Actions](https://github.com/rykellmy31-star/gestor-ponto-multiempresa/settings/secrets/actions) no repositorio correto. Em **Repository secrets → New repository secret**, nomeie exatamente **CLOUDFLARE_AUDIT_TOKEN** e cole o token. Ele nao aparecera no codigo nem nos logs.
6. Na mesma pagina, em **Variables → New repository variable**, cadastre **CLOUDFLARE_ACCOUNT_ID**, com o Account ID da **mesma conta** Cloudflare do Worker. O Account ID e identificador de recurso, nao uma senha. Nao coloque o token em variables.
7. Informe ao ChatGPT somente **"token de auditoria guardado no GitHub"**; ele pode disparar nova verificacao a partir da branch de desenvolvimento sem voce executar comandos. O passo CI chama tres endpoints oficiais GET para verificar a existencia do D1, o dominio workers.dev e as implantacoes do Worker, sem ler registros de pessoas ou segredos.

## Limites

- O job remoto e **opcional** e so roda se as duas configuracoes do GitHub estiverem presentes. Sem elas, o CI faz **apenas testes locais**, sem acesso Cloudflare.
- O token **D1 Read** verifica metadados, nao repara migracoes nem confere SQL sensivel.
- Este token **nao permite deploy, exclusoes, migracoes nem gravacoes de banco**.
- Nunca colocar Secrets de Worker (\`AUTH_PEPPER\`, \`DATA_KEY\`, \`PLATFORM_BOOTSTRAP_TOKEN\`) em GitHub Actions, a menos que um procedimento futuro explicitamente os exija e justifique.
- Antes de qualquer mudanca real em producao: identificar tabela/migracoes e backups existentes, revisar operacao e obter autorizacao especifica. **Nunca usar token de auditoria como credencial de escrita.**
- Ao concluir auditoria, revogar token na Cloudflare e excluir Secret de GitHub quando nao for mais necessario.

Documentacao oficial: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ e https://developers.cloudflare.com/fundamentals/api/reference/permissions/
