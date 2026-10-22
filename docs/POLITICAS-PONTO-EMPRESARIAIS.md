# Políticas de ponto por empresa

## Entrega

A área empresarial permite habilitar/desabilitar marcações e configurar tolerâncias, arredondamento, tratamento do saldo, aprovação de horas extras e duração máxima. Os limites aceitos combinam a validação existente com a janela de até 24 horas suportada pelo registro empresarial atual. As regras são armazenadas para os cálculos; esta entrega não homologa os relatórios de folha, banco de horas ou ausências.

`GET /api/company/punch-policy` consulta exclusivamente a empresa da sessão. Empresa sem política recebe configuração padrão, com marcações desabilitadas e revisão zero. `PUT` exige administrador empresarial, troca da senha inicial concluída, origem válida, CSRF, flag funcional habilitada e `expected_revision` correspondente à versão lida. Nenhum parâmetro de empresa é aceito. A configuração de produção mantém a função desabilitada.

A gravação revalida a sessão e a empresa dentro do SQL. A política e sua auditoria são gravadas em uma única transação. Conflito de versão ou revogação concorrente aborta toda a transação, incluindo auditoria. Falha da auditoria desfaz a alteração da política. Após resposta incerta, a interface exige nova consulta antes de repetir a gravação.

Desabilitar a política bloqueia novas marcações, inclusive em dias em andamento, mas não apaga registros. Alterar regras não modifica snapshots dos dias iniciados; os registros seguintes daquele dia usam as regras congeladas. Novos dias usam a política atual.

## Migration 0039

Aditiva: inclui `revision` na tabela de políticas e cria `company_punch_policy_audit`, com empresa, administrador, revisão, configuração, hash de IP e data. Triggers recusam administrador de outra empresa, alteração, exclusão e substituição implícita da auditoria. O identificador da auditoria e o par empresa/revisão não podem ser reutilizados.

Políticas preexistentes recebem revisão 1, preservando valores. Não se inventa histórico anterior à migration. A próxima alteração terá revisão 2 e auditoria correspondente.

As migrations 0001–0038 continuam protegidas pelos hashes originais. O provisionador foi revisado para aceitar exatamente as 39 migrations, terminando em `0039_company_punch_policy_audit.sql`, exclusivamente no D1 staging já validado. Produção permanece com 38 migrations e sem autorização de escrita nesta etapa. A futura liberação precisa revisar e autorizar a migration 0039 em produção, além do deploy.

## Testes

- `d1-company-punch-policy`: roteador real e D1 local; defaults, isolamento A/B, CSRF, parâmetros falsificados, limites, gravações concorrentes com mesma revisão, auditoria imutável, rollback por falha da auditoria, revogação concorrente e preservação do snapshot.
- Integrações com schema completo: política de ponto e guarda atômica de administrador, aprovadas localmente após aplicar as 39 migrations.
- 316 testes gerais aprovados; TypeScript da aplicação e testes, build React, 18 verificações de staging e 13 verificações Python das proteções aprovados.
- Rodada remota aprovada: Actions `39671265454`, código `9808e88d5b1848902e816cba4a52d5d64df8c091`, 202 verificações. As duas empresas configuraram políticas pelo navegador real, sem inserir políticas por SQL. Pontos, alteração de regra durante o dia, isolamento e auditoria foram confirmados no D1. A migration 0039 foi aplicada somente no staging. Recuperação remota aprovada em 52 tabelas, com schema e hashes idênticos, no clone `cr-jornada-staging-restore-f0d50ccd371c` (`d42feab3-ffa3-4ff3-822b-336fec9adb94`); produção não foi exportada nem restaurada.

- CI integral `39671265377`: aprovado no mesmo código, incluindo compilação, testes gerais e os três grupos D1. O job de instalação inicial de produção permaneceu desativado.

## Pendências para comercialização

Homologar cálculos empresariais completos, inclusive dias sem marcações e regras válidas na data, ocorrências, ajustes, fechamento e saldos; testar os demais formulários dos perfis; concluir revisão integral das rotas e concorrência; definir backup operacional e cofre; preparar credenciais do proprietário e obter autorização específica antes da liberação em produção.
