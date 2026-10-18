# CR JORNADA — estado real da entrega

## Implementado e preservado
- Painel web de Superadministrador e APIs de login, configuração e cadastro de empresas.
- Banco D1 exclusivo configurado (`cr-jornada-db`) e migração `0010_cr_jornada_platform.sql`.
- Rotas legadas e seus arquivos originais preservados para migração futura.
- Worker configurado para `production`, com verificação de origem e cookies seguros.

## Bloqueio de segurança (intencional)
As rotas de autenticação, funcionários, jornadas, marcações e relatórios herdadas do sistema de empresa única **não possuem isolamento multiempresa**. Para evitar vazamento de dados entre empresas, este pacote retorna HTTP 503 nessas APIs e redireciona telas legadas para `/superadmin`.

**Não está pronto para uso de funcionários ou para implantação pública.** O script `npm run deploy` falha intencionalmente em `scripts/preflight.mjs`. Não remova o bloqueio para contornar o problema.

## Trabalho ainda necessário
1. Migrar `settings`, `setup_state`, `users`, `employees`, `login_identifiers`, `sessions`, `schedules`, `schedule_history`, `schedule_assignments`, `schedule_assignment_cancellations`, `rule_versions`, `holidays`, `work_days`, `punches`, `adjustments`, `occurrences`, `overtime_decisions`, `monthly_closures`, `closure_snapshots`, `audit_log`, `employee_moods`, `data_revision` e demais tabelas relacionadas para isolamento por empresa.
2. Revisar índices UNIQUE, relacionamentos, triggers, chaves estrangeiras, autorizações e escopo de login/recuperação de senha.
3. Vincular administradores e funcionários à empresa e validar `companies.status` em todas as sessões.
4. Implementar provisionamento de empresa, jornada e administrador inicial de modo transacional e seguro.
5. Criar testes de isolamento com duas empresas, incluindo tentativas de acessar IDs cruzados e chamadas concorrentes.
6. Testar migrações em D1 de teste e revisar requisitos legais antes de ativar o ponto.

## Segurança dos ambientes
Este ZIP foi editado localmente. **Nenhuma migração remota nem deploy foi realizado**. O projeto original Farmácia Pague Pouco não foi modificado.
