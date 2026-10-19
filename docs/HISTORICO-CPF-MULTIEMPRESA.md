# CR JORNADA — histórico de ponto empresarial por CPF

## Situação

Implementado **na branch de desenvolvimento**, ainda sem autorização de deploy, migração remota ou abertura de funções de escrita. Esta etapa fornece somente **leitura** de marcações para o funcionário autenticado.

## API de histórico

- `GET /api/employee/cpf-work/history?month=AAAA-MM`.
- Login necessário: sessão empresarial por CPF válida, com `employee_id` e `company_id` obtidos exclusivamente do cookie HttpOnly gerado no servidor.
- Funcionários bloqueados ou arquivados, contas desativadas, empresas suspensas, sessões revogadas/expiradas ou senhas iniciais pendentes não podem consultar.
- Intervalo de consulta: o mês civil especificado (inclusive o primeiro dia, exclusivo o primeiro dia do mês seguinte).
- Os registros consultados vêm de `work_days` e `punches`, com validação também na query: sessão, vínculo funcionário–empresa, status e associação entre a marcação, o dia e o funcionário.
- A resposta omite `ip_hash`, `idempotency_key` e dados do CPF. Inclui empresa, funcionário, mês e dias com sequências de marcações.
- `Cache-Control: private, no-store`; nunca armazenar respostas em cache público.

## Interface

O portal `/funcionario` mostra a seção **Meu histórico de ponto** depois que o login CPF foi confirmado e a senha inicial foi alterada. Permite trocar o mês e atualizar a consulta; os horários são exibidos segundo o fuso da empresa enviado na sessão.

## Segurança e limites

- O frontend pode enviar `company_id` ou `employee_id` na URL, mas a API ignora esses parâmetros: os IDs são vinculados à sessão.
- Não existe `POST`, `PUT`, `PATCH` ou `DELETE` nessa API. Todas as operações de escrita de ponto seguem bloqueadas no roteador central.
- Não há atalho para operar o backend pelo Cloudflare Pages: a página estática não dispõe do D1 nem autentica funcionários por si só.
- O banco D1 usado nos testes automatizados é exclusivamente local. Não executar migrações em ambiente remoto sem autorização.

## Validação

- `tests/employee-cpf-history-route.test.ts`: valida escopo da empresa, sessão ausente/revogada, senha inicial, validação de mês, mudança do ano e ausência de dados sensíveis.
- CI de unidade/rotas separado dos cenários D1: o workflow completo usa três shards de D1 para reduzir timeout de RPC do Vitest, sem remover os testes pesados.
- Antes de produção: validar os cenários em D1 local com usuários e empresas de teste, autorizar staging isolado e revisar todas as rotas de registro de ponto.

## Próximas etapas

Implementar o registro de marcações com transações, idempotência, sequência, proteção por horário/escala e autenticação CPF vinculada à empresa; só desbloquear após testes funcionais e de isolamento completos.

## Extrato CSV pessoal (desenvolvimento)

O botão **Baixar extrato CSV** exporta somente as marcações já recebidas da API
para o mês selecionado e a sessão empresarial atual. Fica desabilitado durante
carregamento, erro ou ausência de marcações. Não cria endpoint nem libera escrita.

O arquivo contém IDs de empresa/funcionário, dia de trabalho, sequência, tipo,
horário no fuso da empresa, instante UTC e identificação técnica da marcação.
Não contém CPF, IP, segredo de sessão ou chave de idempotência. Usa UTF-8 com BOM,
separador ponto e vírgula, escape de aspas e proteção contra fórmulas de planilha.
É um extrato informativo, sem cálculo de jornada, fechamento ou certificação.

Testes: `tests/employee-history-csv.test.ts`.
