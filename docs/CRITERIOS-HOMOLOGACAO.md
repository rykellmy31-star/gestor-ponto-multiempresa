# Critérios de homologação e liberação

Estimativa por escopo: 20 blocos de mesmo peso, 5 pontos percentuais por bloco aprovado. A referência anterior de 85,20% não era auditada e não é usada neste cálculo. A lista mede entregas verificadas no escopo descrito; não estima esforço restante nem certifica segurança integral. Qualquer bloqueio crítico impede produção, independentemente do percentual.

Situação de base: **75,00% — 15 de 20 blocos aprovados**. O ciclo de vínculos está em validação.

| # | Bloco e limite da comprovação | Estado |
|---|---|---|
| 1 | Worker e D1 staging reais e exclusivos | Aprovado |
| 2 | Migrações e guardas de destinos; staging 39, produção 38 | Aprovado |
| 3 | Tipos, build, testes gerais e três grupos D1 | Aprovado |
| 4 | Superadmin: login, empresas, gestores, suspensão/reativação por API | Aprovado |
| 5 | Login empresarial e troca obrigatória da senha inicial | Aprovado |
| 6 | CPF, seleção de empresa e sessões de funcionário | Aprovado |
| 7 | Cadastro de funcionário e edição auditada de nome/cargo | Aprovado |
| 8 | Bloqueio, reativação, desligamento e revogação do vínculo | Em validação |
| 9 | Jornadas individuais/coletivas, horários por dia, histórico e idempotência por API | Aprovado |
| 10 | Política de ponto configurada pelo painel e snapshots | Aprovado |
| 11 | Quatro batidas, sequência, isolamento e repetição idempotente | Aprovado |
| 12 | Histórico e extrato CSV do funcionário | Aprovado |
| 13 | Relatório empresarial de marcações no painel, JSON e CSV | Aprovado |
| 14 | Apuração provisória de horas; não é fechamento definitivo | Aprovado |
| 15 | Página comercial: rascunho, publicação e retirada; captação real desabilitada | Aprovado |
| 16 | Backup staging cifrado, adulteração rejeitada e restauração de 52 tabelas em clone | Aprovado |
| 17 | Ocorrências, feriados e ajustes próprios de cada empresa | Pendente |
| 18 | Fechamento mensal definitivo, reconciliação e reabertura auditada | Pendente |
| 19 | Revisão integral de segurança e demais fluxos visuais; decisões sobre rotas legadas | Pendente |
| 20 | Backup operacional durável, cofre, primeiro Superadmin e publicação autorizada com teste posterior | Pendente |

Evidência de base: homologação `39700818764` (240 verificações reais) e CI `39700818758`, código `1f5ff714c49e50a601f705085d615adf7f8a6364`. A prova de restauração está no Actions `39695712568`: 52 tabelas, schema/hashes idênticos e integridade referencial; clone `27b71f6a-ca6f-4c3e-8d93-0a28e969a5ae`. A chave desse ensaio é efêmera: não se trata de backup operacional de produção.

A configuração de produção e o preflight permanecem bloqueados até os blocos pendentes serem comprovados. Nenhuma autorização de publicação foi presumida.
