# Fechamento mensal empresarial

## Fluxo implementado

`GET /api/company/closures?employee_id=…&month=…` consulta o fechamento vigente. Se estiver aberto, apresenta cálculo provisório e impedimentos. Se estiver fechado, apresenta o snapshot preservado e seu SHA256, verificado antes da resposta.

`POST /api/company/closures` confirma fechamento ou reabertura com senha atual do gestor, motivo de 10 a 500 caracteres e revisão esperada. O fechamento exige também a versão dos dados que o gestor conferiu. Empresa e funcionário vêm da sessão/consulta validada, não de um campo `company_id` enviado pelo cliente. CSRF, origem, feature flag, limite de frequência, sessão e senha são verificados; sessão, empresa, funcionário, senha e versões são revalidados no SQL transacional.

O mês deve ter encerrado no fuso empresarial. Um turno original incompleto também impede o fechamento, mesmo que exista ajuste com quatro horários. Datas sem histórico suficiente, dias abertos/incompletos, extras ou ocorrências pendentes e períodos sem dias calculados impedem o fechamento. Ausências comprovadas continuam compondo o cálculo e precisam ser conferidas pelo administrador.

A migration aditiva `0041_company_monthly_closures.sql` cria:

- Diário imutável de fechamento/reabertura, com empresa, funcionário, mês, revisão, motivo, gestor e instante. Fechamentos contêm snapshot JSON e SHA256; reaberturas preservam as versões anteriores.
- Relógio de alterações por empresa, atualizado por triggers nas fontes da apuração. Uma alteração após a leitura impede fechar um snapshot desatualizado, inclusive se ocorrer durante a transação de confirmação. Mudanças de outra empresa não alteram esse relógio.
- Bloqueios de alterações em pontos, dias e tratamentos do período fechado, além de atribuições/cancelamentos e versões de jornada com efeito retroativo. Reabrir permite nova conferência e outro fechamento, sem apagar o anterior.

O painel oferece consulta, conferência dos dias, justificativa, senha e confirmação explícita. Identifica período aberto/fechado, revisão e SHA256. Filtros alterados descartam a consulta; a confirmação é renovada a cada revisão.

## Limites e pendências

O snapshot é o fechamento operacional do sistema, não uma certificação trabalhista nem substituto automático de documentos legais específicos. Não há transporte automático de banco de horas entre meses.

Dados legados de ocorrências, ajustes, decisões ou fechamentos ainda bloqueiam a apuração e exigem reconciliação própria. Esta entrega não importa ou descarta esses dados. Jornadas sem histórico comprovado também continuam bloqueadas. A decisão empresarial sobre extras pendentes e a reconciliação desses históricos precisam de entrega adicional; não foi reduzido o critério 18 para considerar o bloco inteiro concluído.

Ajustes preservam as marcações originais. O fechamento não transforma marcações históricas incompletas em quatro recibos novos, e a gestão de um turno bruto incompleto continua exigindo revisão do fluxo de ponto/vínculo.

## Evidências

Tipos, build web, 18 testes de guardas e 21 testes selecionados de rotas/apuração/D1 aprovados localmente. O teste D1 aplica as 41 migrations reais e verifica fechamento concorrente (uma confirmação aceita), invalidação após conferência e durante a confirmação, rejeição de senha/CSRF inválidos, isolamento, bloqueio de tratamento fechado, reabertura, novo fechamento e retenção do snapshot anterior.

Código `2068d3e37a96116d1f24ee54109812b24db6aa42`. Homologação remota em andamento: `39706418243`; CI completo: `39706418258`. O cenário remoto usa um vínculo histórico e quatro marcações sintéticas em uma empresa fictícia de staging, para que o mês anterior possa ser encerrado. A origem histórica é fixture SQL, explicitamente distinta das batidas com hora real do servidor. O fechamento e a reabertura são exercidos pelo navegador e pelas APIs publicados. Não representa uso de dados de produção.


A rodada inicial `39706418243` aplicou a migration 0041 no staging e passou os fluxos anteriores, mas parou ao preparar um dia para um vínculo fictício já desligado. O trigger de proprietário ativo recusou corretamente a escrita. Correção `152cf1f656dce5f54b2ab5d553eb1945fa93de62`: criar as marcações enquanto o vínculo fictício está ativo e só então definir o término histórico; teste local com 41 migrations aprovado. Nenhuma guarda ou migration já aplicada foi alterada para contornar a rejeição.


## Homologação remota aprovada — schema 41

Código corrigido `152cf1f656dce5f54b2ab5d553eb1945fa93de62`, Actions `39706943984`: **298 verificações reais aprovadas**. O gestor fechou o mês no navegador; o snapshot foi identificado por SHA256; tratamento em período fechado foi recusado; o gestor reabriu, registrou tratamento e fechou novamente. O D1 confirmou as revisões 1/2/3, retenção do hash original e quatro marcações históricas fictícias preservadas.

No mesmo workflow, recuperação remota aprovada de **55 tabelas** (inclui os diários e o relógio empresarial), schema e hashes de conteúdo idênticos, SHA256/AES-256-GCM e rejeição de adulteração. Destino `cr-jornada-staging-restore-40e6a62e6616`, ID `1d348877-5fa7-4b8b-b733-c5d094cd62d9`. Chave efêmera de ensaio; produção não exportada nem restaurada.

Proteção adicional `71f9cef33ec3a835494e23dc0ec6bf5da77566ff`: recusar fechamento de turno original incompleto, mesmo ajustado. Teste D1 local aprovado. Homologação final `39707152663` aprovada: **298 verificações reais** no código `71f9cef33ec3a835494e23dc0ec6bf5da77566ff`. CI completo `39707152635` aprovado: compilação/testes gerais e três grupos D1; instalação inicial de produção desativada.
