# CR JORNADA — registro de ponto por CPF e empresa (homologação)

## Situação
**Implementado na branch `desenvolvimento-cr-jornada`, DESATIVADO por padrão.** Não usar com empregados reais antes de homologação completa, revisão jurídica/trabalhista aplicável, aprovação do proprietário e implantação em ambiente isolado.

A API usa exclusivamente a sessão individual por CPF e a empresa validada no servidor. Não aceita `employee_id`, `company_id`, horário do computador nem data enviados pelo navegador.

## Novas rotas
- `GET /api/employee/cpf-work/today`: fornece a próxima marcação prevista do dia de trabalho, baseada na sequência do banco. Não modifica dados.
- `POST /api/employee/cpf-work/punch`: recebe `{ "type": "entry|break_start|break_end|exit", "idempotency_key": "UUID" }`. Hora e data vêm do servidor.
- Ambas exigem autenticação CPF válida, vínculo de empresa, usuário/funcionário ativo, senha inicial trocada, flag global `ENABLE_EMPLOYEE_PUNCHES=true` e política empresarial explícita `enabled=1` em `company_punch_policies`.
- Escrita também exige `X-CSRF-Token`, chave de idempotência UUID e limite de requisições. As rotas antigas de ponto continuam fechadas pelo roteador central.
- Erros de sequência, empresa, registro legado sem empresa e período já fechado recusam novas batidas.

## Estrutura D1 local
A migração `0023_company_punch_policies.sql` cria regras por empresa. Não insere políticas automaticamente, não habilita empresa alguma nem reconcilia registros antigos. O trigger `punches_company_policy_enabled` protege todas as novas inserções em dias que tenham `work_days.company_id` definido, mesmo se chamadas por outra rota.

A rota consulta somente jornadas atribuídas ao funcionário cuja `schedules.company_id` corresponde à empresa de sua sessão. O dia criado contém `company_id`, jornada e regras congeladas (snapshot). Os comandos de criação do dia e registro de ponto são executados por `D1.batch` e os triggers existentes do banco impõem a sequência `entrada → início do intervalo → fim do intervalo → saída` e a imutabilidade dos registros.

Se duas solicitações tiverem a **mesma chave** e o **mesmo tipo**, a resposta pode reutilizar a confirmação original, sem nova marcação. Chaves distintas não podem substituir uma batida na mesma sequência.

## Limitações intencionais
- Somente turnos **sem virada da meia-noite**, com dia previsto no calendário semanal e em janela limitada de horário. Jornadas noturnas e cruzamentos de data ainda necessitam de regras próprias.
- As regras empresariais precisam ser cadastradas, revisadas e ativadas **em staging separado**, mediante autorização. Não existe painel para habilitar políticas nesta etapa.
- A autorização do ponto **não** representa certificação como registrador eletrônico de ponto, nem garante conformidade com legislação do Ministério do Trabalho.
- A prévia Cloudflare Pages é estática e não executa essas APIs. Não habilitar ponto real no Pages e não inserir dados reais de empregados.
- Funcionários antigos com dias `company_id=NULL` precisam de conciliação administrativa própria, sem alterar o histórico na preparação desta etapa.
- Não executar migrações D1 remotas, deploy de Worker, alteração na `main` ou migração de empregados da Farmácia Pague Pouco.

## Testes
- `tests/employee-cpf-punch-route.test.ts` valida bloqueio por flag, autenticação, CSRF, idempotência, sequência e empresa autenticada.
- `tests/d1-employee-punch-policy.test.ts` verifica bloqueio da política no D1 local, marcações de outra empresa e duplicidades.
- `tests/d1-employee-company-workdays.test.ts` valida o esquema aditivo de dias empresariais e integridade referencial.

## Próximos controles antes da liberação
1. Testes de ponta a ponta com Worker e D1 exclusivos de homologação, inclusive concorrência e falhas de rede.
2. Rotina empresarial autenticada de configuração das regras e dos horários, com auditoria e períodos de vigência.
3. Jornadas noturnas, ocorrências, ajustes, folgas e períodos fechados revisados por empresa.
4. Comprovantes, exportações, relatórios, requisitos regulamentares e política de guarda de registros validados.
5. Aprovação explícita antes de habilitar `ENABLE_EMPLOYEE_PUNCHES` ou realizar qualquer deploy remoto.
