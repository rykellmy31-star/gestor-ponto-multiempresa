# Jornada — controle de ponto

Aplicação **funcional**, em português, com React + TypeScript, API Hono em Cloudflare Workers, banco Cloudflare D1/SQLite, PDF gerado no servidor e arquivos estáticos no mesmo Worker. Nenhum registro de ponto é armazenado como banco no navegador.

> **Situação desta entrega:** implementação e testes locais reais em `workerd`/D1. O build de produção e a simulação de publicação são verificados. **Não há implantação na sua conta Cloudflare nem domínio de produção configurado.** Siga [PUBLICACAO.md](docs/PUBLICACAO.md) para autorizar sua própria conta e publicar sem revelar segredos nesta conversa.
>
> **Limite jurídico importante:** este projeto é um controle de jornada e não é apresentado como REP-P certificado/conforme à Portaria 671. Não implementa INPI, comprovante PAdES/ICP-Brasil ou arquivos fiscais AFD/AEJ. Antes do uso como registrador oficial, faça validação jurídica, trabalhista e técnica. Veja [SEGURANCA.md](docs/SEGURANCA.md).

## O que está implementado

- Acessos independentes de funcionário e administrador; criação inicial protegida por segredo de uso restrito, sem senha padrão ou cadastro administrativo aberto.
- Senhas com scrypt, salt individual e pepper; sessões revogáveis em cookies HttpOnly, CSRF, limitação de tentativas e autorização no servidor.
- Funcionário entra com usuário, matrícula ou e-mail, troca senha inicial e vê somente seus dados.
- Quatro marcações sequenciais, com UTC do servidor: entrada → intervalo → retorno → saída. Repetição da mesma tentativa não duplica a marcação.
- Cadastro de funcionários, bloqueio/desligamento, versões de jornada, vigências, feriados, justificativas, correções justificadas, horas positivas sujeitas a aprovação e auditoria imutável para a aplicação.
- Cálculos diários/semanais/mensais, intervalos não remunerados por padrão, virada noturna/mensal, faltas, abonos, atrasos, tolerância e arredondamento configuráveis.
- Dashboard com dados do banco; filtros e formulários responsivos.
- Folha mensal com todos os dias, horários, totais, ocorrências e assinaturas; PDF A4 paisagem no servidor, impressão e CSV seguro para planilha.
- Fechamento/reabertura com snapshots versionados e hash; histórico fechado não é recalculado silenciosamente.
- Recuperação por link de uso único emitido por administrador reautenticado; e-mail automático opcional; recuperação administrativa privilegiada pela CLI Cloudflare.
- Migrations SQL, backup cifrado e ferramenta de descriptografia; teste de restauração em banco separado.

## Início local — instalação nova

Requisitos: **Node.js 22.13+**, npm e acesso à internet para instalar pacotes. Não é necessária uma conta Cloudflare para desenvolvimento local.

```bash
npm ci
npm run secrets:local
npm run db:local
npm run dev
```

Abra `http://localhost:8787`. `npm run secrets:local` gera três segredos independentes, sem imprimir seus valores e sem sobrescrever um `.dev.vars` existente. `.data/` é o banco persistente local; **não o apague** para atualizar a aplicação.

### Primeiro administrador

1. No seu **terminal privado**, execute `npm run setup:token`.
2. Abra `http://localhost:8787/setup` e informe esse código, a empresa, o fuso, seu usuário e sua senha forte.
3. Entre em `/admin/entrar`. Não existe uma credencial administrativa padrão.
4. Após a configuração, remova apenas a linha `BOOTSTRAP_TOKEN` do `.dev.vars` e reinicie o servidor. A trava de primeira instalação também está persistida no banco.
5. Guarde `AUTH_PEPPER` e `DATA_KEY` em um cofre. Não os altere ou regenere ao atualizar: o primeiro protege senhas; o segundo protege os CPFs cifrados.

**Na prévia da Arena**, use o endereço HTTPS de prévia na interface, mantendo os mesmos caminhos. Ela usa D1 **local**; não é o serviço de produção e pode deixar de responder quando o ambiente for encerrado. A instalação principal foi mantida limpa, sem as pessoas e marcações do banco de testes.

## Endereços

| Finalidade | Caminho |
|---|---|
| Acesso do funcionário | `/entrar` |
| Ponto / folha / solicitações | `/app`, `/app/folha`, `/app/solicitacoes` |
| Acesso administrativo separado | `/admin/entrar` |
| Dashboard / funcionários | `/admin`, `/admin/funcionarios` |
| Registros / relatórios / ocorrências | `/admin/registros`, `/admin/relatorios`, `/admin/ocorrencias` |
| Jornadas / configurações / administradores / auditoria | `/admin/jornadas`, `/admin/configuracoes`, `/admin/administradores`, `/admin/auditoria` |
| Instalação inicial restrita | `/setup` |
| Recuperação | `/recuperar-senha`, `/redefinir-senha#token=...` |

As URLs protegidas são verificadas no Worker, antes de servir a página. As APIs repetem a autorização por perfil e propriedade do registro. Conhecer uma URL ou um ID não concede acesso.

## Documentação

- [Publicação Cloudflare, domínio e atualização](docs/PUBLICACAO.md)
- [Uso, cadastro, marcações e fechamento](docs/USO.md)
- [Regras e fórmulas dos cálculos](docs/CALCULOS.md)
- [Segurança, privacidade e limitações](docs/SEGURANCA.md)
- [Backup, restauração e recuperação de administrador](docs/BACKUP-RECUPERACAO.md)
- [Testes, reprodução e evidências](docs/TESTES.md)

## Comandos principais

| Comando | Efeito |
|---|---|
| `npm run typecheck` | TypeScript estrito da aplicação |
| `npm test` | Testes unitários |
| `npm run build` | Typecheck + frontend + Wrangler **dry-run**, sem publicar |
| `npm run deploy` | Bloqueia placeholders/insegurança, depois publica na conta autorizada |
| `npm run db:local` / `npm run db:remote` | Aplica migrations no alvo explicitamente indicado pelo comando |
| `npm run backup -- --local` / `--remote` | Exporta e cifra o banco; pede frase privada |
| `npm run admin:recover -- --remote --login SEU_USUARIO` | Link temporário para administrador existente; exige privilégio Cloudflare |

O código está em `server/` e `web/`, o esquema em `migrations/`, as ferramentas em `scripts/` e os testes em `tests/`. `public/` e `.worker-bundle/` são gerados pelo build. O pacote de entrega não contém `.dev.vars`, bancos, backups, credenciais de testes ou `node_modules`.
