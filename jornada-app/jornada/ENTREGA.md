# Jornada · entrega do sistema de ponto

**15 de outubro de 2026 · implementação funcional e testada**

## Situação real, sem simulação

| Item | Situação |
|---|---|
| Aplicação completa com frontend, API e banco | **Implementada** — React/TypeScript + Worker Hono + D1 |
| Gravação de ponto, cálculos, permissões, relatórios | **Testados com requisições e banco reais**, não apenas aparência |
| Prévia disponível nesta conversa | **Jornada · controle de ponto**, na interface de prévia da Arena |
| Banco da prévia | **D1 local persistente**, instalação principal limpa |
| Contas/senhas padrão | **Não existem** — primeiro administrador exige configuração restrita |
| Cloudflare da sua empresa / domínio definitivo | **Não publicados nem testados remotamente** |
| Conformidade formal REP-P | **Não declarada** — exige avaliação e adequações antes do uso oficial |

A prévia integrada é protegida pelo próprio ambiente da Arena e pode deixar de existir ao encerrar o ambiente. Ela **não é uma implantação na sua conta Cloudflare**. Não é necessário divulgar token de tráfego, segredo ou senha para abrir a prévia dentro da interface.

## Arquivos da entrega

- **[Baixar projeto completo em ZIP](../Jornada-controle-de-ponto.zip)** — código, configuração, migrations, ferramentas, testes e documentação.
- [README e início rápido](README.md).
- [Guia exato de publicação Cloudflare](docs/PUBLICACAO.md).
- [Manual de operação](docs/USO.md).
- [Regras de cálculo](docs/CALCULOS.md).
- [Segurança, privacidade e limitações](docs/SEGURANCA.md).
- [Backup e recuperação](docs/BACKUP-RECUPERACAO.md).
- [Testes e reprodução](docs/TESTES.md).
- Evidências selecionadas: `docs/evidencias/` no projeto. Incluem JSONs, logs de build/instalação e PDFs/screenshots **do banco isolado de testes**.

**Não acompanham o ZIP:** `.dev.vars`, bancos, backups, credenciais privadas, contexto de testes, `node_modules` ou caches. A instalação da empresa não foi preenchida com funcionários/relatórios fictícios.

## Endereços de acesso

Na prévia integrada, use os caminhos abaixo na mesma origem. Após instalar no seu computador, os endereços são:

- Funcionário: `http://localhost:8787/entrar`.
- Administrador: `http://localhost:8787/admin/entrar`.
- Configuração inicial: `http://localhost:8787/setup`.
- Folha do funcionário: `/app/folha`.
- Relatórios administrativos: `/admin/relatorios`.

Em produção, substitua a origem pelo **seu domínio HTTPS real**, depois da publicação. Não existe uma URL definitiva de Cloudflare já entregue.

## Começar com a sua própria instalação

Requisito: Node.js **22.13+**. Extraia o ZIP e entre na pasta `jornada`:

```bash
npm ci
npm run secrets:local
npm run db:local
npm run dev
```

1. Em **terminal privado**, execute `npm run setup:token`.
2. Abra `/setup`, informe o código e escolha você mesmo nome da empresa, fuso, usuário e senha forte do primeiro administrador.
3. Entre em `/admin/entrar`. Remova apenas `BOOTSTRAP_TOKEN` do `.dev.vars` após a instalação e reinicie o servidor; guarde `AUTH_PEPPER` e `DATA_KEY` no cofre.
4. Cadastre uma **jornada**, depois um **funcionário** com matrícula, usuário e senha inicial exclusivos.
5. O funcionário entra em `/entrar`, troca a senha inicial e registra as quatro etapas do dia. Todos os horários comuns são do servidor.
6. Em **Folhas e relatórios**, escolha mês/ano, confira pendências, exporte PDF/CSV ou imprima A4. Corrija somente com justificativa; feche o mês após revisar.

Não me envie nenhum código, senha ou chave. A criação inicial é restrita precisamente para evitar uma senha administrativa pública/padrão.

## Resultados de verificação

**90/90 cenários automatizados aprovados:**

- **33** unitários: cálculos, datas, viradas, tolerâncias, validação e criptografia.
- **31** integração: autenticação/autorização, D1 real, marcações, correções, revisão, fechamento e recuperação.
- **12** navegador: formulários e botões reais, desktop/celular, retry após perda de resposta, exportação, impressão e recuperação assistida.
- **14** adicionais: concorrência, sessão revogada, vigências, paginação de auditoria, CSV seguro, notas longas, CLI de recuperação e backup cifrado/restaurado.

Também passaram: TypeScript estrito de aplicação/testes; Vite/Worker dry-run; inspeção de **4 PDFs** com todos os dias/totais/assinaturas e sem texto fora da página; reinício real com dados preservados; instalação nova a partir apenas do código e zero dados; auditoria de dependências de produção com **0 vulnerabilidades reportadas** no momento da execução.

**Não foram executados:** deploy/redeploy remoto, DNS/TLS/headers/cookies no edge de produção, ensaio de Time Travel/importação em D1 remoto, envio de e-mail real, teste de carga ou certificação/pentest independente.

## O que falta para colocar na Cloudflare

O [guia de publicação](docs/PUBLICACAO.md) contém cliques, comandos e checklist completos. Em resumo, o responsável pela sua conta deve:

1. Autorizar o Wrangler e conferir conta/plano Workers Paid.
2. Criar D1 e inserir o **ID real** no `wrangler.jsonc`.
3. Aplicar migrations remotas.
4. Definir domínio/origem HTTPS real e instalar **Secrets próprios** em cofre/Cloudflare.
5. Rodar `npm run deploy`, criar o primeiro administrador e remover o segredo temporário de instalação.
6. Validar a operação no edge remoto e ensaiar backup/restauração antes de liberar à equipe.

O comando `npm run build` é **somente build + simulação**, não publicação. O projeto mantém placeholders bloqueados de propósito para não publicar uma configuração insegura ou fingir um banco/domínio existente.

## Limites essenciais

- Controle de jornada com quatro marcas/dia e um intervalo; sem marcação offline ou múltiplos turnos automáticos no mesmo dia.
- Saldo aprovado por dia/semana/mês, não razão completa de banco com vencimento/transporte automático, nem folha financeira/adicional noturno legal.
- Recuperação assistida funciona sem e-mail. Envio automático é opcional, exige provedor/remetente e ainda precisa ser validado na sua conta.
- **Não é apresentado como REP-P certificado/conforme à Portaria 671.** Faltam os requisitos formais específicos descritos na documentação, como registro INPI, comprovantes/assinaturas fiscais e arquivos AFD/AEJ. Faça avaliação jurídico-trabalhista e técnica antes de adotá-lo como registrador oficial.
