# CR JORNADA — ambientes de visualização e testes

> Guia de implantação por etapas. Este arquivo **não autoriza deploy remoto, migrações nem provisionamento de segredos**.

## 1. Pages — demonstração visual já conectada

- Fonte: repositório `rykellmy31-star/gestor-ponto-multiempresa`, branch `desenvolvimento-cr-jornada`.
- Build: `npm run build:web`.
- Saída: `public`.
- Rota interativa **somente visual**: `/demo-superadmin`.
- A rota `/superadmin` é o login real. Sem o backend do Worker, ela não autentica ninguém.
- Os cadastros da demonstração existem apenas em memória, com nomes e documentos fictícios; desaparecem ao recarregar.
- O Pages é um site acessível por URL. Não inserir CPFs, senhas ou dados reais nessa demonstração. Para restringir o acesso, configurar Cloudflare Access no Pages conforme as opções disponíveis no painel.

## 2. Futuro Worker de testes de ponta a ponta

Objetivo: permitir login verdadeiro de um usuário de **teste**, sem afetar farmácias nem clientes.

Preparar um Worker exclusivo, por exemplo `cr-jornada-staging`, e um **novo** banco D1 exclusivo, por exemplo `cr-jornada-staging-db`. O banco existente `cr-jornada-db` permanece reservado e não deve ser compartilhado com testes.

O Worker staging deverá servir a interface React em `ASSETS` e `/api` no **mesmo domínio**, evitando misturar sessão e APIs de outros ambientes. Como o arquivo `wrangler.jsonc` atual aponta para a produção, é indispensável uma configuração staging separada com o ID real do novo banco, `APP_ORIGIN` do staging e nome de Worker exclusivo. **Não usar deploy com a configuração de produção para testar**.

Segredos separados devem ser criados diretamente no dashboard da Cloudflare, nunca compartilhados em mensagens, GitHub ou código:

- `AUTH_PEPPER`: segredo aleatório, com pelo menos 32 caracteres, exclusivo do staging.
- `DATA_KEY`: chave hexadecimal aleatória de 64 caracteres, exclusiva do staging.
- `PLATFORM_BOOTSTRAP_TOKEN`: segredo aleatório, entre 32 e 128 caracteres, exclusivo do cadastro inicial do superadmin de testes.
- `CPF_LOOKUP_SECRET`: segredo independente para CPF, com ao menos 32 caracteres; só necessário quando o login por CPF for ativado.

Depois de testar as migrações **localmente** e revisar o plano de isolamento, criar as tabelas no **novo banco de testes** mediante autorização específica, configurar o Worker de staging, criar o primeiro superadmin fictício pelo fluxo seguro de `/api/platform/setup` e então acessar `/superadmin` pelo domínio do staging.

## 3. Barreiras obrigatórias antes da publicação funcional

1. Build e TypeScript aprovados.
2. Testes D1 local e isolamento empresarial aprovados; corrigir timeouts de processos Wrangler da suíte completa.
3. Autenticação de superadmin, CSRF, sessão e revogação testados no Worker staging.
4. Cadastro de empresas testado com dados fictícios.
5. Migrações de matrícula e isolamento das rotas de ponto completas, sem lacunas de empresa.
6. Backups, recuperação e plano de rollback documentados e testados.
7. Nenhuma alteração em `folhadeponto-paguepouco`, `folhadeponto-paguepouco-teste` ou em seus respectivos bancos.

## 4. Publicação final

Ao aprovarmos os testes, criaremos a instalação definitiva do CR JORNADA e cadastraremos a Farmácia Pague Pouco como primeira empresa, sem importar registros antigos. Essa mudança só ocorrerá com autorização do proprietário e validação da operação.
