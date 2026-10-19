# CR JORNADA — escalas diferentes por dia da semana

## Pedido atendido no código
Agora a mesma escala pode ter o horário padrão de segunda a sexta e um **horário específico de sábado**.

Exemplo de teste:
- Segunda a sexta, 08:00–12:00 e 13:00–17:00 = **8 horas por dia**.
- Sábado, 07:00–13:00 com pausa de 10:00–10:15 **remunerada** = **6 horas computadas**.
- Total semanal **46 horas** (5 × 8 + 6). A jornada CLT comum é de até 44 horas semanais; o cadastro mostra um alerta de conferência para escalas acima de 44h. Necessidades específicas devem ser analisadas caso a caso.

## Como usar a interface
No painel de desenvolvimento, `/admin/jornadas` → Nova jornada/Editar:
1. Preencha entrada, início e fim do intervalo e saída para o horário padrão.
2. Pressione **Selecionar segunda a sexta** para marcar os cinco dias de uma vez (ou ajuste os dias individualmente).
3. Pressione **Adicionar sábado separado**; os horários de sábado aparecerão em formulário próprio, com entrada, pausa e saída editáveis.
4. A prévia mostra a duração diária padrão, do sábado e a **carga total da semana**, levando em conta as exceções.

O sábado não precisa virar uma segunda escala e não é necessário editar cada dia de segunda a sexta um por um. Dias opcionais como domingo continuam selecionáveis separadamente. A visualização apresenta o horário do sábado na ficha de cada escala.

## Compatibilidade e regras
- JSON das escalas antigas **não foi migrado nem alterado**. Uma escala sem `day_overrides` continua com o mesmo horário nos dias marcados.
- A nova propriedade opcional é `day_overrides: { "6": { "start": "07:00", "break_start": "10:00", "break_end": "10:15", "end": "13:00", "paid_break": true } }`, onde 0 = domingo, 1 = segunda ... 6 = sábado. O mesmo formato pode representar exceções em outros dias da semana.
- O backend valida entradas e intervalos em ordem, duração válida, dia especial selecionado, e calcula a carga semanal somando **a jornada efetiva de cada dia**.
- O cálculo dos relatórios usa a jornada daquele dia para conferir previsto, atrasos, saídas antecipadas, intervalo remunerado/não remunerado, saldos e horas positivas.
- A rota de ponto por CPF resolve a escala por data ao criar o dia de trabalho e mantém um snapshot dos horários para preservar o histórico.
- A API autenticada da empresa em `/api/company/schedules` aceita novas escalas com horários separados. Continua protegida por login e pela flag `ENABLE_COMPANY_SCHEDULES`, desativada no ambiente remoto.
- Os caminhos antigos de administração `/admin` do projeto legado continuam protegidos no Worker oficial. A tela foi atualizada na branch de desenvolvimento, mas a utilização real do painel de empresas depende da homologação da autenticação e da interface empresarial. Não anunciar uma implantação remota como concluída.

## Cuidados
- Intervalos remunerados não devem ser habilitados automaticamente para satisfazer um valor de horas: configure a remuneração e o intervalo real conforme contrato/legislação. O horário de sábado usado acima é apenas **exemplo editável**.
- A rota de marcação de ponto atualmente exige quatro registros, inclusive nos turnos especiais. Escalas sem qualquer intervalo, turnos muito curtos e escalas noturnas precisam de regras de ponto adicionais antes de serem liberadas.
- Nenhum Worker remoto, D1 remoto, branch `main` ou registros da Farmácia Pague Pouco foram modificados.

## Testes
`tests/calculations.test.ts` verifica o total de 46h, o cálculo exato das 6h do sábado, a compatibilidade com escala antiga e a rejeição de exceções inválidas. `tests/company-schedules.test.ts` cobre a criação empresarial e a recusa de horário especial para dia não selecionado.
