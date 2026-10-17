# Regras de cálculo e integridade temporal

A implementação central está em `server/core/calculations.ts`, com datas/viradas em `time.ts`, composição histórica em `reports.ts` e testes determinísticos em `tests/calculations.test.ts`.

## Horário e dia de trabalho

- Registros comuns usam `Date.now()` **no Worker**. O cliente envia tipo e chave de tentativa, não o horário do ponto.
- Os instantes são inteiros UTC em milissegundos. A apresentação usa America/Bahia ou America/Sao_Paulo, por configuração explícita.
- Cada dia iniciado guarda cópias de fuso, jornada e regras. Reconfigurar a empresa não altera a interpretação de um dia já aberto.
- Em turno noturno, as quatro marcas pertencem ao **dia lógico de início**. Ex.: entrada em 30/09 às 22h e saída em 01/10 às 7h pertencem à folha de setembro. Não se perde a saída por buscar apenas timestamps entre os limites UTC do mês.
- Um turno previsto pode atravessar meia-noite, mas deve ter menos de 24h. O limite de manutenção de jornada aberta é configurável entre 12 e 36h (padrão 24h); expirado o limite ou havendo dia anterior pendente, é necessária conferência administrativa.
- Não há múltiplos turnos comuns por dia, múltiplos intervalos, escala cíclica 12×36 automática ou marcação offline. A versão suporta uma jornada de quatro marcas/dia, com dias da semana configuráveis.

## Horas previstas

Para um dia dentro da admissão/desligamento e incluído nos dias da jornada:

`previstas = saída prevista − entrada prevista − intervalo previsto não remunerado`

Se o intervalo for configurado como remunerado, não é subtraído. Dias sem expediente, feriado cadastrado ou folga aprovada têm previsão zero. Um dia futuro pode aparecer na **previsão integral do mês**, mas não vira falta ou déficit antes do fim do turno.

## Horas reais e intervalos

`realizadas = (saída do intervalo − entrada) + (saída final − retorno)`

São contados somente pares de marcas existentes e na ordem correta. Intervalo remunerado, quando configurado, soma a duração real da pausa. Ausência de uma marca **nunca é preenchida** com o horário da escala.

O cartão do ponto pode mostrar duração **em andamento**, identificada como tal, estimada entre a última entrada e o horário do servidor. O relatório formal usa pares efetivamente registrados, não uma saída presumida. O total de dias trabalhados conta dias com alguma marca, inclusive os que ainda exigem conferência; incompletos têm contador separado.

## Abonos

Atestado ou ausência justificada **aprovada com abono**:

`abonadas = máximo(0, previstas − realizadas)`

Abono cobre o restante da carga, não cria ponto original e não vira horas reais. Folga aprovada retira a previsão, em vez de fabricar crédito. Pedidos pendentes ou recusados não abonam.

## Atrasos, saídas antecipadas e tolerâncias

- Atraso = diferença positiva entre entrada real e prevista.
- Saída antecipada = diferença positiva entre saída prevista e real.
- A tolerância por marcação só zera esse indicador quando a diferença está dentro da margem configurada.
- A tolerância diária zera pequena diferença líquida **somente em dia completo, com previsão positiva**, e quando entrada e saída estão dentro da tolerância individual. Uma entrada 6min atrasada não é apagada por uma margem diária maior quando a margem individual é 5min.
- Tolerância não elimina minutos trabalhados em feriados/folgas.

Padrões iniciais: **5min por marcação**, **10min por dia**, arredondamento de **1min para baixo**, aprovação automática de extra **desligada**. São parâmetros iniciais, não uma declaração de adequação a toda convenção coletiva. Configure e valide com o RH antes de operar.

## Arredondamento

O arredondamento é aplicado à **duração final calculada**, não aos timestamps originais. Opções: 1, 5, 10 ou 15 minutos; para baixo, mais próximo ou para cima. Os segundos originais permanecem armazenados para auditoria. Uma mudança de regra tem vigência e não modifica dias já iniciados.

## Positivas, extras, faltantes e saldo

Depois de encerrado o turno (ou com quatro marcas):

`saldo bruto = realizadas + abonadas − previstas`

`faltantes = máximo(0, −saldo bruto)`

Diferença positiva só vira candidata a extra com quatro marcas completas:

`positivas candidatas = máximo(0, saldo bruto)`

- Por padrão ela fica **pendente**.
- O administrador aprova tudo, aprova uma quantidade parcial ou recusa, sempre com motivo e reautenticação.
- Crédito aprovado nunca supera a diferença positiva apurada.
- Aprovação parcial trata o restante como não aprovado; não há duplicação do crédito.
- Se os horários tratados mudarem, o hash da base anterior deixa de corresponder e a aprovação deve ser revisada.
- A aprovação automática só ocorre com configuração explícita vigente.

`saldo aprovado = extras aprovadas − faltantes`

Saldo bruto pode, portanto, ser positivo enquanto saldo aprovado é zero: isso é intencional, e não perda de horas. As positivas pendentes ficam em coluna/total próprios.

### Política de compensação

- **Conferência**: saldo informativo aprovado, para análise do responsável.
- **Banco aprovado (saldo do período)**: registra nas regras e nas ocorrências do relatório a destinação do saldo aprovado ao banco, sem transformar pendências em crédito automático.

**Não há razão contábil de banco com transporte automático entre meses, vencimento de créditos, acordos individuais ou liquidação financeira.** Dia, semana e mês têm saldos apurados; sua destinação deve respeitar o acordo aplicável. O sistema não calcula valor de extra, adicional noturno/hora reduzida, DSR, descontos de salário, encargos ou folha financeira.

## Semana, mês e períodos históricos

- Totais são somas de minutos, sem o erro de reiniciar após 24h. Ex.: 22 dias de 8h = **176:00**.
- Resumos semanais começam na segunda-feira. Dentro de uma folha mensal, a primeira/última semana inclui **apenas os dias daquele mês**, não horas de outro espelho.
- Calendário inclui 28/29/30/31 dias, respeita dias fora do vínculo e não cria marcações nas lacunas.
- Regras/jornadas usam a vigência adequada à data. Snapshot do dia tem prioridade sobre mudanças posteriores. Meses fechados usam o snapshot de fechamento, incluindo identificação da empresa/funcionário vigente naquele fechamento.

## Fechamento e concorrência

A abertura do dia, sequência e idempotência têm validações de API e restrições/triggers SQL. Fechamentos usam uma revisão do conjunto de dados para não congelar um relatório ultrapassado por alterações concorrentes. Um conflito exige atualizar e repetir a operação, não confirmar um resultado potencialmente incorreto.

O fechamento exige mês anterior, último turno encerrado, nenhuma marcação parcial, nenhuma justificativa/extra pendente e jornada válida durante o vínculo. Triggers bloqueiam alterações comuns em mês fechado; reabertura explícita, motivo e auditoria são obrigatórios. Versões anteriores são preservadas.
