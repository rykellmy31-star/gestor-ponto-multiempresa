# Recuperação assistida do funcionário

Implementação exclusivamente na branch de desenvolvimento. Não fazer deploy,
migrar D1 remoto ou habilitar a funcionalidade sem homologação autorizada.

## Fluxo preparado

O gestor autenticado na área da empresa pode escolher um funcionário ativo,
confirmar sua própria senha e gerar uma senha provisória. O funcionário deve
ter conta ativa com vínculo CPF na mesma empresa. Nenhuma conta nova é criada
ou desbloqueada pelo procedimento.

- API: `POST /api/company/employees/:id/reset-password`.
- Corpo estrito: somente `current_password` do gestor.
- Exige sessão empresarial, senha inicial já substituída, CSRF, senha atual do
  gestor e limites por gestor/IP. A empresa vem da sessão, nunca do corpo.
- Requer `ENABLE_EMPLOYEE_PASSWORD_RECOVERY=true`, ausente das configurações
  versionadas e desativada por padrão.
- Senha gerada no servidor com 96 bits de entropia, válida por 24 horas.
  Só o hash é armazenado; o texto claro aparece uma vez na resposta `no-store`.
- Redefinição incrementa a versão pelo trigger de usuários, revoga as sessões
  do alvo e grava auditoria na mesma transação. Não atinge o funcionário de
  outra empresa, mesmo que ambos tenham o mesmo CPF.
- O gestor, a sessão, o vínculo, o usuário e a empresa são revalidados no UPDATE.
  Conflito ou erro de auditoria desfaz senha, prazo e revogação.
- Senha provisória expirada é recusada no login, na seleção de empresa e na
  consulta de sessão. Uma sessão emitida antes do prazo também deixa de valer.
- O funcionário precisa alterar a provisória antes de acessar o ponto. A troca
  remove o prazo, revoga sessões e registra evento de forma atômica.

## Migração e rastreabilidade

A migração aditiva `0027_employee_password_recovery.sql` cria um prazo opcional
em `users` e eventos `company_employee_security_events`. Não redefine nenhuma
conta, não liga flags e não importa dados legados. Eventos têm FKs compostas
para usuário/funcionário/empresa, guarda do gestor da empresa e são imutáveis.
Senhas, CPF, hashes de credenciais e tokens não são incluídos nesses eventos.

## Interface e entrega da senha

A área da empresa exibe a recuperação em um painel independente das escalas.
O gestor confirma o alvo e informa sua senha; a provisória é descartada ao fechar
ou sair da sessão. Não há armazenamento em localStorage ou envio automático por
email/WhatsApp. Se a resposta se perder, o gestor deve conferir o acesso e, se
necessário, gerar outra provisória; a senha anterior não pode ser consultada.

A identidade do funcionário deve ser conferida antes da entrega por um canal
seguro. O canal de entrega, notificações e a revisão visual responsiva são
pendências de homologação. O portal do funcionário orienta procurar o gestor.

## Testes locais

- `d1-employee-password-atomic`: sucesso e rollback ao falhar revogação.
- `d1-employee-password-recovery`: sessão, CSRF, flag, reautenticação, corpo
  estrito, isolamento com mesmo CPF, expiração, seleção antiga, troca obrigatória,
  concorrência e imutabilidade da auditoria.
- O contador `meta.changes` do D1 pode incluir operações de triggers; a guarda
  usa `changes()` dentro do batch e evita reportar conflito após uma troca válida.

Todos esses testes usam banco efêmero local e credenciais fictícias.
