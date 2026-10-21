# CR JORNADA — auditoria de isolamento e travas de homologacao

**Data:** 2026-10-21. **Branch:** `desenvolvimento-cr-jornada`.
**Escopo:** verificacao de codigo + CI, auditoria de producao somente leitura, 158 verificacoes HTTP em staging real e recuperacao remota de dados ficticios. Isto **nao e** laudo de pentest nem auditoria de backups operacionais de producao.

## Evidencias confirmadas

- Banco existente `cr-jornada-db`: **38 de 38** migracoes registradas e **52 tabelas nao internas**, lidas via auditoria remota. Nao ha Superadmin criado automaticamente. Job de primeira instalacao desativado.
- Worker publico existente `gestor-ponto-multiempresa` com binding `DB` correspondente. `wrangler.jsonc` corrigido para esse mesmo nome/origem; `scripts/verify-production-target.mjs` valida o destino localmente antes de uma futura publicacao.
- GitHub Actions: build React, dry-run do Worker de producao, simulacao do Worker staging sem credenciais, testes TypeScript, testes de rotas e verificacoes de segurança.
- Staging real: Worker `gestor-ponto-multiempresa-staging`, D1 `41604781-5fbf-4287-beca-64e20ce1ee1f`, 38 migrations e Secrets exclusivos; 158 verificacoes HTTP de autenticacao, empresas, funcionarios, CPF, jornadas, ponto, suspensao e pagina comercial aprovadas.
- Backup: AES-256-GCM, SHA256 e adulteracao testados; restauracao remota aprovada no Actions `39666007053` em outro D1, com 51 tabelas, schema e hashes identicos e integridade referencial aprovada. Dados ficticios; backup operacional de producao permanece pendente.
- `scripts/preflight.mjs` continua bloqueando o deploy de producao. Nao remover o bloqueio para contornar homologacao.

## Isolamento por modulo (auditoria parcial)

| Modulo/rotas | Controles identificados em codigo | Evidencia de teste / condicao atual |
|---|---|---|
| `/api/platform/setup` | Token de inicializacao independente, limite de tentativas, registro atomico de Superadmin e auditoria | `d1-platform-setup-atomic`; nao foi criado Superadmin no D1 real |
| `/api/platform/auth/*` | Sessao Superadmin isolada, cookie proprio, validade e invalidacao por `auth_version` | Testes de plataforma; validacao externa pendente |
| `/api/platform/companies/*` | Superadmin autenticado, CSRF para mutacoes, operacoes de administradores vinculadas ao `company_id` | `platform-company-admins`, `d1-platform-company-onboarding`; revisao integral de cada mutacao ainda pendente |
| `/api/company/auth/*` | Login com slug + usuario, sessao empresarial associada ao `company_id`, CSRF e bloqueio de empresa suspensa | `company-auth`, `d1-company-login-race` |
| `/api/company/employees` | Middleware empresarial, `WHERE company_id=?` na listagem; cadastro e recuperacao condicionados a flags | `company-routing`, `company-employees`, `d1-company-employee-onboarding`; flags ainda desabilitadas na configuracao base |
| `/api/company/schedules/*` | `requireCompanyAdmin`, `company_id` obtido da sessao, verificacoes SQL na escrita em lote e controle de conflitos | `company-schedules`, `company-schedules-bulk`, `d1-company-schedules-bulk-operation`; flag ainda desabilitada |
| `/api/employee/cpf-auth/*` | Identidade por CPF e selecao de vinculo validado, sessao de usuario/funcionario/empresa propria | `employee-cpf-auth-route`, `d1-employee-cpf-isolation`, `d1-employee-session-isolation` |
| `/api/employee/cpf-work/history` | Acesso pela sessao CPF; consulta filtra `employee_id` e `company_id` derivados da sessao | `employee-cpf-history-route`, `d1-employee-history-safety` |
| `/api/employee/cpf-work/punch` | Sessao CPF, politica de pontos da empresa, validacao do dia e idempotencia; flag de escrita desabilitada | `employee-cpf-punch-route`, `d1-employee-cpf-full-workday`; teste com Worker staging real pendente |
| `/api/public/*` / pagina comercial | Pagina publica fornece apenas versao publicada; leads dependem de flag e consentimento | `platform-sales`, `sales-leads`, `d1-platform-sales-leads` |
| Rotas antigas `/api/admin/*`, `/api/employee/*`, `/api/auth/*` | Middleware central retorna `tenant_isolation_pending` e nao chama a logica antiga | `company-routing` e matriz adicional para empresas A/B |

*A tabela registra a base da auditoria. As validacoes remotas que estavam pendentes para os fluxos centrais foram executadas conforme `HOMOLOGACAO-STAGING-ISOLADA.md`. Isso nao certifica toda combinacao de sessao, empresa, corrida e SQL. Flags foram habilitadas somente no perfil funcional de staging; producao e rotas legadas mantem as travas.*

## Travas ainda abertas para liberar producao

1. Auditar **todas** as rotas e triggers de D1, inclusive mutacoes pouco usadas, execucoes concorrentes, CPF repetido em duas empresas e autorizacao apos suspensao/arquivamento.
2. Completar validacao de interface, relatorios/exportacoes e configuracao das politicas de ponto pelo painel. Os fluxos HTTP centrais com duas empresas passaram; politicas de ponto foram fixtures SQL de staging, nao configuradas pela interface.
3. Manter os Secrets exclusivos e revisar cada flag antes de qualquer futura liberacao produtiva. Nenhuma chave de producao foi copiada.
4. Definir backup operacional cifrado de producao com cofre, retencao e janela aprovada. O ensaio de restauracao remota de staging ja passou; ele nao substitui a copia operacional. Nunca restaurar destrutivamente em producao.
5. Publicar versao revisada apenas apos remover a trava de preflight **por justificativa tecnica sustentada por evidencias** e aprovacao do proprietario. O nome/origem do Worker ja foram conciliados, mas ainda nao foi feito deploy.
6. Configurar primeiro Superadmin com segredo temporario exclusivo, sem enviar chave/senha em logs, e concluir homologacao de perfis reais.

## Politica de proxima fase

O token D1 Edit temporario de producao foi revogado pelo proprietario. Qualquer autorizacao futura para staging deve ser separada, de curta duracao e **nunca autorizar gravacao no D1 de producao** por engano. CI padrao permanece apenas local e read-only.
