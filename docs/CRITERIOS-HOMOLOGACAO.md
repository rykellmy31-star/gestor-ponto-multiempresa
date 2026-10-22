# Critérios de homologação e liberação

Estimativa por escopo: 20 blocos de mesmo peso, 5 pontos percentuais por bloco aprovado. A referência anterior de 85,20% não era auditada e não é usada neste cálculo. A lista mede entregas verificadas no escopo descrito; não estima esforço restante nem certifica segurança integral. Qualquer bloqueio crítico impede produção, independentemente do percentual.

Situação atual: **85,00% — 17 de 20 blocos aprovados**. Calendário e tratamentos empresariais foram homologados no staging real.

| # | Bloco e limite da comprovação | Estado |
|---|---|---|
| 1 | Worker e D1 staging reais e exclusivos | Aprovado |
| 2 | Migrações e guardas de destinos; staging 41, produção 38 (última comprovação) | Aprovado |
| 3 | Tipos, build, testes gerais e três grupos D1 | Aprovado |
| 4 | Superadmin: login, empresas, gestores, suspensão/reativação por API | Aprovado |
| 5 | Login empresarial e troca obrigatória da senha inicial | Aprovado |
| 6 | CPF, seleção de empresa e sessões de funcionário | Aprovado |
| 7 | Cadastro de funcionário e edição auditada de nome/cargo | Aprovado |
| 8 | Bloqueio, reativação, desligamento e revogação do vínculo | Aprovado |
| 9 | Jornadas individuais/coletivas, horários por dia, histórico e idempotência por API | Aprovado |
| 10 | Política de ponto configurada pelo painel e snapshots | Aprovado |
| 11 | Quatro batidas, sequência, isolamento e repetição idempotente | Aprovado |
| 12 | Histórico e extrato CSV do funcionário | Aprovado |
| 13 | Relatório empresarial de marcações no painel, JSON e CSV | Aprovado |
| 14 | Apuração provisória de horas; não é fechamento definitivo | Aprovado |
| 15 | Página comercial: rascunho, publicação e retirada; captação real desabilitada | Aprovado |
| 16 | Backup staging cifrado, adulteração rejeitada e restauração de 55 tabelas em clone | Aprovado |
| 17 | Feriados, ocorrências aprovadas pelo administrador e ajustes por empresa na apuração provisória | Aprovado |
| 18 | Fechamento mensal definitivo, reconciliação e reabertura auditada | Parcial: fechamento/reabertura aprovados; reconciliação e decisões pendentes |
| 19 | Revisão integral de segurança e demais fluxos visuais; decisões sobre rotas legadas | Pendente |
| 20 | Backup operacional durável, cofre, primeiro Superadmin e publicação autorizada com teste posterior | Pendente |

Evidência de base: homologação `39700818764` (240 verificações reais) e CI `39700818758`, código `1f5ff714c49e50a601f705085d615adf7f8a6364`. A prova de restauração está no Actions `39695712568`: 52 tabelas, schema/hashes idênticos e integridade referencial; clone `27b71f6a-ca6f-4c3e-8d93-0a28e969a5ae`. A chave desse ensaio é efêmera: não se trata de backup operacional de produção.

Avanço do bloco 8: código `439243efd23cddea0f1ad6cef3a87bc0c8db9e3d`, homologação real `39702861660`, 263 verificações aprovadas. Inclui o ciclo visual completo, sessões revogadas, novo login após reativação, B preservada e três eventos de auditoria, com os quatro pontos de A intactos. A falha inicial de associação do seletor ao rótulo foi corrigida antes da aprovação.

CI do mesmo código `39702861726` integralmente aprovado: compilação/testes gerais e os três grupos de integração D1. Instalação inicial em produção permaneceu desativada.

A configuração de produção e o preflight permanecem bloqueados até os blocos pendentes serem comprovados. Nenhuma autorização de publicação foi presumida.

Avanço do bloco 17: código `65beb4602dc5a1d81e435a1f6cf9eaeace090b29`, staging `39704886478`, **285 verificações aprovadas**. Ajuste no navegador, isolamento A/B, abono, cancelamento, revisão e preservação de pontos comprovados. Recuperação do schema 40: **53 tabelas**, schema/hashes idênticos; clone `33121b53-b6a4-4160-bd86-82975de380c4`. Ocorrências são aprovadas diretamente pelo gestor; ajustes não fecham o estado bruto de turnos incompletos. Limites em `TRATAMENTOS-EMPRESARIAIS.md`.

CI do código `65beb4602dc5a1d81e435a1f6cf9eaeace090b29` integralmente aprovado no Actions `39704886537`: compilação/testes gerais e três grupos D1. Instalação inicial em produção permaneceu desativada.

Avanço parcial do bloco 18: fechamento/reabertura empresarial no navegador e histórico imutável aprovados em `39706943984` (298 verificações), com recuperação do schema 41 em clone de 55 tabelas. O bloco permanece pendente: reconciliação de dados legados/sem histórico e decisões de extras pendentes exigem entrega adicional. **O percentual permanece 85,00%**, sem reclassificar o bloco ou substituir faltas de evidência por uma estimativa de esforço.

Homologação final do fechamento: `39707152663`, código `71f9cef33ec3a835494e23dc0ec6bf5da77566ff`, 298 verificações reais aprovadas. Inclui a proteção adicional para não fechar turno original incompleto mesmo ajustado.

CI final do código `71f9cef33ec3a835494e23dc0ec6bf5da77566ff` aprovado em `39707152635`: compilação/testes gerais e três grupos D1. A instalação inicial de produção permaneceu desativada.
