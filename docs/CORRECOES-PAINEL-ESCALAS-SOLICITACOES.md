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
- A execução remota e o ensaio de recuperação terminaram com sucesso na rodada final abaixo.

Progresso geral permanece estimado em 85,00% (17/20 critérios). Esta entrega não encerra automaticamente os critérios amplos de segurança, conciliação e publicação final.

Primeira execução remota `39764709999`: migração 0043 e publicação realizadas; os fluxos de ponto, relatórios, escala atribuída, solicitações, humor e liberação do ponto passaram. O ensaio parou ao procurar um modelo criado por API sem atualizar o catálogo já carregado no navegador. O script foi corrigido para usar o botão Atualizar antes da exclusão; a homologação completa deve ser repetida.

Segunda rodada `39765638820`: os tipos e testes prévios passaram; a automação identificou que o rótulo do seletor Nova escala incluía o texto das opções. O campo recebeu nome acessível explícito. A edição de horários agora conserva também o funcionário selecionado ao abrir a nova versão. O CI completo da primeira implementação (`39764710023`) aprovou 381 testes (324 gerais + 57 D1 em três grupos).

Terceira rodada `39766242898`: todos os fluxos visuais novos passaram, incluindo alteração de escala, preservação do funcionário ao editar horários, solicitações, humor, visão geral e exclusão. A verificação final ainda esperava as três atribuições da fixture antiga; passou a exigir as quatro datas exatas, incluindo a nova atribuição criada pelo formulário. A bateria será repetida sem alterar a implementação da aplicação.

## Homologação dos painéis e escalas — 22/10/2026

Código `76fc79cf542a00de0d259591b5010b204ce9ca4b`. [Homologação real 39766727757](https://github.com/rykellmy31-star/gestor-ponto-multiempresa/actions/runs/39766727757) aprovada com **343 verificações**; [CI 39766727804](https://github.com/rykellmy31-star/gestor-ponto-multiempresa/actions/runs/39766727804) integralmente aprovado: **381 testes**, sendo 324 gerais e 57 D1 em três grupos. Produção e main foram preservados.

Visão geral com escala atribuída e contador de solicitações, consulta do ponto com motivo específico de bloqueio, botão de liberação pelo gestor, alteração de escala e edição em nova versão pela aba Funcionários, exclusão de modelos sem apagar histórico, solicitações e respostas empresariais, pesquisa de humor agrupada e envio da logomarca do dispositivo foram verificados no navegador e no D1 real, usando duas empresas fictícias. A interface restaurada foi preservada e incorporada à branch de desenvolvimento.

Staging: Worker `gestor-ponto-multiempresa-staging`, D1 `41604781-5fbf-4287-beca-64e20ce1ee1f`, **43 migrações**. Backup criptografado e restauração aprovados: **60 tabelas**, schema e hashes idênticos, SHA256/AES-256-GCM e rejeição de adulteração. Destino separado `cr-jornada-staging-restore-5bc75a378df4` (`12a82d3d-ed71-4bea-b27d-2ba7fb4b8f4b`). Produção não foi exportada nem restaurada. A chave do ensaio continua efêmera; o cofre e o backup operacional durável de produção permanecem pendentes.

**85,00% = 17/20 critérios aprovados**. Os fluxos novos avançam parcialmente o bloco 19; não encerram a reconciliação do bloco 18 nem a revisão integral de segurança e preparação operacional/publicação dos blocos 19–20. Limites da exclusão e da resposta a justificativas em [CORRECOES-PAINEL-ESCALAS-SOLICITACOES.md](CORRECOES-PAINEL-ESCALAS-SOLICITACOES.md).
