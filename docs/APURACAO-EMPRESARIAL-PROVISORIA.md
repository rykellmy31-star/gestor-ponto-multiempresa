# Apuração empresarial provisória

## Escopo entregue

`GET /api/company/reports/calculations?employee_id=...&month=AAAA-MM`, com `format=csv` opcional, oferece apuração por funcionário no painel empresarial. Calcula horas previstas/trabalhadas, intervalos remunerados ou não, tolerâncias, atrasos, saída antecipada, saldo bruto, extras pendentes e dias sem marcações a conferir. O período mostra a cobertura dos dados e os dias não calculados.

A apuração é **provisória**, tanto na API como na tela e no CSV. Não é fechamento de folha nem confirmação automática de falta. Ocorrências e feriados devem ser conferidos antes de utilizar valores no fechamento; o relatório não importa o calendário global legado para uma empresa. Banco de horas definitivo, calendário por empresa, ocorrências empresariais, ajustes e fechamento ainda precisam de entrega própria.

## Isolamento e consistência

- Empresa derivada da sessão de administrador. Funcionário de outra empresa retorna 404. Parâmetros de empresa, filtros desconhecidos/repetidos e mês inválido são recusados.
- Sessão e empresa revalidadas no SQL de cada conjunto de dados; consultas executadas em um único `D1.batch` de leitura. Revogação antes do batch impede retorno dos dados.
- Não consulta configurações globais, versões globais de regras ou calendário global. As rotas antigas continuam bloqueadas.
- Dias empresariais iniciados usam jornada, fuso e regras congelados, mesmo após alteração da política, escala atual, fuso da empresa ou término posterior do vínculo.
- Marcações precisam pertencer ao funcionário e ao dia empresarial. Sequência, tipos, quantidade e cronologia são validados; inconsistência ou snapshot inválido aborta a apuração em vez de produzir totais parciais incorretos.
- Sem dia iniciado: consulta a atribuição empresarial ativa na data, respeitando cancelamentos e versões históricas de horários; exige atribuição criada antes do início previsto e política auditada habilitada antes desse início.
- Desativação do ponto durante o expediente, ausência de histórico, dia legado sem empresa ou dia não iniciado exigem conferência e são excluídos dos totais. Datas futuras e datas fora do vínculo não geram faltas presumidas.
- O fuso atual da empresa é usado nos dias sem snapshot. A revisão histórica do fuso e de outras alterações cadastrais permanece necessária antes de um fechamento definitivo.
- Ocorrências, decisões de extras e fechamentos legados sem histórico empresarial comprovado bloqueiam a apuração com `company_report_reconciliation_required`; ajustes associados ao dia também exigem conciliação. Seus conteúdos não são expostos pelo novo endpoint. Registros de outro funcionário/empresa não afetam a consulta.
- Extras positivos ficam pendentes, exceto quando a regra congelada admite aprovação automática. Não há transporte automático de saldo entre meses.
- CSV identifica a natureza provisória, usa minutos em colunas explícitas, protege contra fórmulas e não expõe a matrícula técnica interna. Respostas sem cache; exportações exigem a sessão empresarial.

## Validação

- `company-calculations`: atraso, intervalo, jornada às 07h/13h, congelamento de regras/horários, dias de folga, ausência a conferir com histórico válido, ausência de histórico, atribuição retroativa, desativação durante expediente, futuro, legado, extras pendentes e corrupção de dados.
- `d1-company-calculations`: aplica as **39 migrations reais** no D1 local, sem recriar tabelas simplificadas; testa A/B, dois funcionários da mesma empresa com horários distintos, transição de jornada, cancelamento, snapshots imutáveis, CSV, bloqueio de legado e revogação concorrente.
- 322 testes gerais aprovados localmente; integrações locais de apuração, marcações e políticas aprovadas; TypeScript da aplicação/testes e build React aprovados.
- Código inicial da apuração: `6d40adca566686f1eb2d5755542846f5e4eb5627`. Rodada seguinte `ead8fd018ae563cca951fe3f3e5dfefb7539e613` acrescenta login visual Superadmin/funcionário, escolha de empresa e extrato no navegador. Também associa os rótulos aos campos de CPF e senha, inclusive troca inicial.
- Apuração remota aprovada no Actions `39673853923`, código `6d40adca566686f1eb2d5755542846f5e4eb5627`: 223 verificações, incluindo API, isolamento, snapshots, painel mensal e CSV nas duas empresas. Recuperação remota aprovada em 52 tabelas, schema e hashes idênticos, em `cr-jornada-staging-restore-6d0dca1fa746` (`cafb3c66-1717-407a-b17a-6d7433993d5f`). Rodada complementar `39674118629`, código `ead8fd018ae563cca951fe3f3e5dfefb7539e613`, aprovada com 230 verificações: Superadmin autenticou pelo formulário e visualizou as duas empresas; funcionário autenticou por CPF, selecionou cada vínculo, visualizou a jornada concluída e baixou o extrato. Recuperação novamente aprovada em 52 tabelas, clone separado `cr-jornada-staging-restore-02b3d3191742` (`6b33fe89-5993-409b-be88-2c1c7d5b6212`).

- CI integral `39674118477` aprovado no código `ead8fd018ae563cca951fe3f3e5dfefb7539e613`: compilação, 322 testes gerais e todos os três grupos de integração D1. Instalação inicial de produção permaneceu desativada.

## Estado de infraestrutura

Usa o mesmo Worker e D1 staging existentes, com 39 migrations. Não exige migration nova. Produção mantém 38 migrations e a trava de publicação. Nenhum banco de produção foi recriado, migrado, exportado ou restaurado nesta entrega.
