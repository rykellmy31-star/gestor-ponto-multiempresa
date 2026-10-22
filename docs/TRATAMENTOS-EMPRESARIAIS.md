# Feriados, ocorrências e ajustes empresariais

## Implementação

A migration aditiva `0040_company_day_events.sql` cria um diário imutável. Cada tratamento registra empresa, funcionário quando aplicável, data, tipo, revisão, valor, motivo, administrador e instante. Uma alteração ou cancelamento acrescenta uma revisão; não substitui registros anteriores. Triggers recusam alteração, exclusão, substituição e associação a administrador ou funcionário de outra empresa.

`GET/POST /api/company/day-events` usa a sessão empresarial. Escritas exigem CSRF/origem válidos, esquema estrito, revisão esperada e revalidação de sessão/empresa no SQL da transação. Conflitos abortam a escrita. Meses com fechamento legado fechado bloqueiam alterações; esses dados legados continuam exigindo conciliação para apuração.

- Feriado: vale para toda a empresa, sem funcionário na escrita.
- Ocorrência aprovada: folga, atestado ou ausência justificada para um funcionário. A opção remunerada segue as regras existentes de cálculo.
- Ajuste: quatro horários ordenados, sem horários futuros, com duração máxima de 24 horas e entrada na data informada no fuso da empresa. Exige dia original iniciado. A apuração conserva `raw_marks` e identifica o ajuste e sua justificativa.

O painel empresarial permite consultar por funcionário/mês, salvar e cancelar com motivo. As consultas retornam a última revisão de cada tratamento. Filtros alterados descartam a consulta anterior; falhas de escrita exigem nova consulta.

## Limites

A apuração continua provisória. Ajustes não modificam `punches`, comprovantes ou o estado bruto de um turno incompleto. O fechamento definitivo e sua reabertura pertencem a uma entrega posterior. Ocorrências são aprovadas diretamente pelo administrador: não há, nesta entrega, solicitação pendente do funcionário nem fluxo de aprovação em duas etapas. Dados legados não são importados automaticamente. Calendário não fabrica faltas em datas sem histórico comprovado de jornada e política.

## Verificação desta entrega

Tipos de aplicação/testes, build web e 18 testes de guardas aprovados localmente. Testes D1 aplicam as 40 migrations reais e verificam isolamento, revisão desatualizada, CSRF, imutabilidade, cancelamento de feriado, abono, ajuste com preservação das marcações, ausência de dia original e bloqueio de tratamentos em mês fechado. A rodada selecionada de rotas/cálculo passou com 21 testes.

Homologação remota aprovada no Actions `39704886478`, código `65beb4602dc5a1d81e435a1f6cf9eaeace090b29`: **285 verificações reais**. Feriado de B não alterou a apuração de A; cancelamento restaurou a jornada prevista; atestado gerou abono; administrador salvou ajuste pelo navegador; quatro versões ficaram auditadas e todas as marcações originais permaneceram idênticas no D1. Consulta/escrita cruzadas, CSRF inválido e revisão desatualizada foram recusados.

O mesmo workflow restaurou **53 tabelas** em `cr-jornada-staging-restore-3c8477ba6eac`, ID `33121b53-b6a4-4160-bd86-82975de380c4`: schema e hashes de conteúdo idênticos; SHA256, AES-256-GCM e rejeição de adulteração aprovados. Chave efêmera de ensaio, sem backup operacional de produção. Staging tem 40 migrations; produção permanece fora desta operação, com a última comprovação de 38. CI completo `39704886537` aprovado: compilação/testes gerais e três grupos D1.
