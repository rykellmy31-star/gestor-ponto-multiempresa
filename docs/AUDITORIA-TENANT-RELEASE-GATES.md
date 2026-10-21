# CR JORNADA — auditoria de isolamento e travas de homologacao

**Data:** 2026-10-21. **Branch:** `desenvolvimento-cr-jornada`.
**Escopo:** verificacao de codigo + CI e auditoria Cloudflare somente leitura. Isto **nao e** laudo de pentest, homologacao remota ou auditoria de backups de producao.

## Evidencias confirmadas

- Banco existente `cr-jornada-db`: **38 de 38** migracoes registradas e **52 tabelas nao internas**, lidas via auditoria remota. Nao ha Superadmin criado automaticamente. Job de primeira instalacao desativado.
- Worker publico existente `gestor-ponto-multiempresa` com binding `DB` correspondente. `wrangler.jsonc` corrigido para esse mesmo nome/origem; `scripts/verify-production-target.mjs` valida o destino localmente antes de uma futura publicacao.
- GitHub Actions: build React, dry-run do Worker de producao, simulacao do Worker staging sem credenciais, testes TypeScript, testes de rotas e verificacoes de segurança.
- Backup: teste automatizado usa SQLite **local e ficticio** para cifrar em AES-256-GCM, descriptografar, restaurar os registros, recusar senha incorreta e detectar adulteracao. **Nao comprova** backup remoto da Cloudflare.
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

*Status acima descreve **controles observados**, nao uma certificacao de que cada combinacao de sessao, empresa, corrida e SQL seja segura.*

## Travas ainda abertas para liberar producao

1. Auditar **todas** as rotas e triggers de D1, inclusive mutacoes pouco usadas, execucoes concorrentes, CPF repetido em duas empresas e autorizacao apos suspensao/arquivamento.
2. Provar testes ponta a ponta com **duas empresas ficticias em um Worker e D1 staging reais e separados**, incluindo CSRF, expiracao/revogacao de sessoes, cadastros, horarios distintos por dia, atribuicao em lote, registro de ponto e relatorios.
3. Confirmar secrets exclusivos do staging sem copiar chaves de producao; liberar flags uma por vez, mediante resultados medidos.
4. Criar backup externo cifrado do D1 correspondente, verificar manifesto e restaurar em **outro** banco isolado com verificacao de integridade. Nunca executar restauracao destrutiva em producao.
5. Publicar versao revisada apenas apos remover a trava de preflight **por justificativa tecnica sustentada por evidencias** e aprovacao do proprietario. O nome/origem do Worker ja foram conciliados, mas ainda nao foi feito deploy.
6. Configurar primeiro Superadmin com segredo temporario exclusivo, sem enviar chave/senha em logs, e concluir homologacao de perfis reais.

## Politica de proxima fase

O token D1 Edit temporario de producao foi revogado pelo proprietario. Qualquer autorizacao futura para staging deve ser separada, de curta duracao e **nunca autorizar gravacao no D1 de producao** por engano. CI padrao permanece apenas local e read-only.
