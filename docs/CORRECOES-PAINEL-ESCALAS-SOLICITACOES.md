# Correções dos painéis empresariais e do funcionário — 22/10/2026

A interface restaurada em `restaurar-interface-original-pagpouco` (1108c3a) foi incorporada à branch de desenvolvimento por avanço direto, preservando os 33 commits anteriores e o envio da logomarca do dispositivo (554f5de). Produção e main não foram modificados.

## Problemas e comportamento resultante

- A visão geral consultava `/api/company/reports/overview`, mas o filtro central bloqueava essa rota nova. Foi incluída somente a leitura autenticada prevista; as rotas legadas continuam bloqueadas. A tabela mostra a escala atribuída na data consultada e o indicador mostra a quantidade real de justificativas sem resposta.
- A consulta do relógio tratava uma condição de bloqueio como falha total de carregamento. Ela agora apresenta horário do servidor, jornada e motivo específico, mantendo todos os bloqueios da gravação de ponto. Dias iniciados conservam os horários congelados. Política desativada não é habilitada silenciosamente: o gestor tem o botão **Liberar registro de ponto** na visão geral e as regras completas em Configurações.
- A aba Funcionários mostra a escala em vigor, horários e prévia de sete dias. Permite atribuir um novo modelo por data ou abrir uma nova versão dos horários. Atribuições diferentes na mesma data continuam sendo conflito explícito; alterar uma jornada não reescreve pontos já confirmados.
- **Excluir escala** remove o modelo do catálogo com confirmação e registro imutável. As atribuições existentes e o histórico são preservados; isso não desliga um funcionário da sua jornada. Não se modifica nem se contorna o trigger original que proíbe apagar escalas.
- O funcionário envia justificativas datadas, acompanha a situação e lê a resposta do gestor. O gestor responde em Ocorrências. Aceitar uma justificativa não altera automaticamente horários nem abonos; tratamentos financeiros e ajustes continuam no fluxo auditado de Ocorrências.
- O funcionário responde à pesquisa de humor uma vez por dia e por vínculo. O painel empresarial apresenta somente totais agrupados dos últimos sete dias quando há pelo menos três participantes distintos. Não retorna nomes nem respostas individuais ao gestor. Dados legados de outras empresas não são importados.

## Segurança e dados

Migração aditiva `0043_company_workspace.sql`: quatro tabelas próprias para pesquisa, solicitações, decisões e arquivo de modelos. Vínculos são validados por FK e triggers; registros são imutáveis e protegidos contra `INSERT OR REPLACE`. Leituras e gravações vinculam a empresa à sessão, revalidam credenciais no SQL e mantêm CSRF, origem, limitação de tentativas e revogação por suspensão.

As 38 migrações antigas permanecem intactas. O provisionamento só aceita o inventário revisado de 43 migrações e mantém as verificações do Worker, conta e D1 exclusivos de staging. Nenhuma migração de produção é autorizada por este documento.

## Validação

- TypeScript da aplicação e dos testes aprovado.
- 324 testes de lógica, rotas e autorização aprovados antes da publicação.
- Novo ensaio D1 com o roteador real e todas as migrações: solicitações A/B, CSRF, decisões únicas, pesquisa com limiar de privacidade, bloqueio de ponto explícito sem liberar POST, arquivo de modelos preservando atribuições, imutabilidade e suspensão.
- Script de homologação ampliado para navegar pela interface restaurada, consultar a escala em Funcionários, enviar solicitações e humor, responder como gestor, liberar ponto pela visão geral e excluir um modelo fictício.
- A execução remota e o ensaio de recuperação precisam terminar com sucesso antes de considerar esta entrega homologada.

Progresso geral permanece estimado em 85,00% (17/20 critérios). Esta entrega não encerra automaticamente os critérios amplos de segurança, conciliação e publicação final.

Primeira execução remota `39764709999`: migração 0043 e publicação realizadas; os fluxos de ponto, relatórios, escala atribuída, solicitações, humor e liberação do ponto passaram. O ensaio parou ao procurar um modelo criado por API sem atualizar o catálogo já carregado no navegador. O script foi corrigido para usar o botão Atualizar antes da exclusão; a homologação completa deve ser repetida.
