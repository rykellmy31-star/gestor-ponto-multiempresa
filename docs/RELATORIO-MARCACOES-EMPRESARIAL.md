# Relatório mensal de marcações por empresa

## Entrega

A área `/empresa/jornadas` oferece consulta por funcionário e mês, com download CSV. A API nova é exclusivamente `GET /api/company/reports/attendance?employee_id=...&month=AAAA-MM`, com `format=csv` opcional. A listagem utiliza a matrícula visível da empresa, preservando o identificador técnico interno.

O relatório mostra dias de ponto existentes, marcações, fuso horário e hashes de comprovantes. A interface converte cada horário usando o fuso congelado no dia de ponto. O CSV identifica os horários como UTC para evitar interpretação ambígua.

Esta entrega não calcula folha, faltas, banco de horas ou fechamento mensal. A inexistência de marcação não prova falta ou folga. Os relatórios legados continuam bloqueados até terem autorização empresarial adequada.

## Controles

- Empresa derivada exclusivamente da sessão de administrador empresarial. Não há parâmetro de empresa aceito.
- Mesma flag conservadora `ENABLE_COMPANY_SCHEDULES`, desabilitada na configuração de produção. O perfil funcional de staging habilita explicitamente esse conjunto.
- Sessão ativa, versão de autenticação, expiração, tempo ocioso e troca inicial de senha verificados. Suspensão da empresa bloqueia acesso.
- Autorização revalidada dentro das duas consultas SQL, além do middleware, para impedir vazamento de marcações quando há suspensão/revogação concorrente.
- Funcionário e dia vinculados à mesma empresa; marcações precisam corresponder ao funcionário do dia. Dias legados sem empresa não são retornados.
- Mês limitado a 2000–2099, parâmetros desconhecidos ou repetidos recusados, SQL parametrizado. Sem listagem global ou alteração de registros.
- `Cache-Control: private, no-store`; CSV servido como anexo com nome construído apenas a partir do mês validado.
- Células CSV escapam aspas, delimitadores e quebras de linha; entradas com potencial fórmula são prefixadas para impedir execução em planilhas.
- Mudança de filtros cancela a consulta e remove o resultado anterior. Respostas atrasadas de consultas canceladas são ignoradas. Expiração da sessão limpa a área empresarial.

## Validação

- `tests/d1-company-attendance.test.ts`: roteador real com D1 local, empresas A/B, matrícula empresarial, consulta mensal, exclusão de legado e de marcação com funcionário divergente, tentativa de injeção, parâmetros falsificados/repetidos, CSV, revogação por versão, troca de senha e suspensão concorrente.
- TypeScript da aplicação e dos testes aprovados localmente; interface compilada; 316 testes gerais aprovados. CI integral `39669565321` aprovado no commit `b8894153b0b106a550538bbed32b09b7b4de8021`: compilação, testes gerais e todos os três grupos de integração D1; instalação inicial de produção continua desativada.
- `scripts/exercise-cloudflare-staging.mjs`: realiza consultas JSON/CSV com as duas empresas fictícias após quatro batidas por funcionário. Chromium acessa o Worker real, autentica pelo formulário empresarial com credenciais fictícias exclusivas de QA, consulta pelo painel e confirma o download CSV. Os demais formulários visuais continuam sujeitos a homologação própria.
- Primeira rodada `39668871759`: API JSON/CSV das duas empresas aprovada; painel interrompido por timeout na localização do seletor. Recuperação remota aprovada separadamente na mesma rodada, em 51 tabelas. Rótulos dos filtros foram associados explicitamente aos campos e o teste passou a autenticar pelo formulário real. Nova rodada `39669565281`, commit `b8894153b0b106a550538bbed32b09b7b4de8021`, aprovada: 179 verificações, incluindo login pelo formulário, consulta e download CSV em Chromium para ambas as empresas. Recuperação remota novamente aprovada: 51 tabelas, schema e hashes idênticos, em `cr-jornada-staging-restore-c1625a77e900` (`54214342-1417-47c2-8949-017e816297d3`). Nenhuma escrita, exportação ou restauração em produção.

## Próximas entregas necessárias

Configurar as políticas de ponto pela interface com auditoria e concorrência; homologar os formulários visuais de todos os perfis; implementar e validar os cálculos empresariais de ausências, atrasos e saldo preservando snapshots históricos; revisar integralmente as demais rotas; preparar backup operacional de produção e as credenciais iniciais do proprietário. A trava de produção permanece ativa.
