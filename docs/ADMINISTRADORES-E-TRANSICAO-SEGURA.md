# CR JORNADA — responsáveis por empresa e transição segura

## Funcionamento do Superadmin (código na branch de desenvolvimento)
No painel `/superadmin`, cada empresa cadastrada ganhou a opção **Administradores**.

O Superadmin pode:
- Consultar os gestores da empresa selecionada, sem consultar senhas ou sessões.
- Cadastrar responsável com nome, login, e-mail opcional e senha inicial de pelo menos 12 caracteres. A senha é transformada em hash no backend, não é retornada na resposta e não é enviada automaticamente por e-mail.
- Suspender ou reativar o acesso de um gestor da empresa. Na suspensão, a versão de autenticação é incrementada e as sessões desse gestor são revogadas. Os responsáveis de outras empresas não são alterados.
- Ver os acessos **apenas da empresa escolhida**. A rota de escrita utiliza sessão de Superadmin, proteção CSRF, limite por IP e auditoria da operação.

A tela empresarial separada `/empresa/entrar` exige **identificador da empresa, usuário e senha**. Após login e homologação de `ENABLE_COMPANY_SCHEDULES`, o responsável acessa `/empresa/jornadas`, cadastra escalas agrupadas de segunda a sexta, escolhe sábado separado e atribui escalas a seus funcionários.

### Controles essenciais pendentes
- Primeira senha deve ser transmitida por canal seguro (nunca colar senhas reais em chat, em arquivos do repositório ou na Pages estática).
- Fluxo para alteração obrigatória da senha inicial e recuperação segura ainda precisa ser desenvolvido e testado antes do uso em produção.
- Revisar autorizações, auditoria, expiração/revogação de sessões e acesso à UI empresarial num Worker/D1 de homologação exclusivamente fictício.
- A API permite suspensão imediata de gestores. Não oferece exclusão irreversível de cadastros administrativos.
- Cloudflare Pages estática **não** autentica Superadmin ou administradores empresariais.

## Farmácia Pague Pouco — primeira empresa apenas após aprovação

**Situação atual: nenhuma transição ou importação foi realizada.** A Farmácia Pague Pouco existente continua no Worker e no banco original. O CR JORNADA não usa, escreve ou lê os dados de produção desse sistema.

A futura transição deverá acontecer em fases:

1. **Desenvolvimento isolado:** corrigir o projeto e completar testes automáticos, sem executar migrações remotas.
2. **Homologação:** criar Worker e D1 exclusivamente de testes para o CR JORNADA, usar somente empresas e funcionários fictícios.
3. **Auditoria:** verificar gestão de acessos, jornadas (inclusive sábado diferente), registro de ponto, comprovantes, relatórios, fechamento e requisitos legais/segurança aplicáveis.
4. **Planejamento da empresa inicial:** com autorização expressa do responsável, cadastrar a Farmácia Pague Pouco como empresa na plataforma e preparar os acessos. Não importar históricos antigos automaticamente.
5. **Validação e escolha da data:** comparar jornadas com dados autorizados, manter o legado acessível, definir estratégias de backup, retorno e suporte, e realizar corte de operação somente após aprovação explícita.

Nenhum funcionário antigo, senha, histórico de registro ou batida será criado/importado na nova plataforma **sem decisão expressa**. A ativação deve ocorrer na data aprovada, depois de homologação integral, nunca apenas porque o cadastro de escala foi implementado.

## Testes
`tests/platform-company-admins.test.ts` cobre a autenticação do Superadmin, proteção CSRF, consulta por empresa, senha não exposta, suspensão com revogação de sessões e bloqueio de administrador pertencente a outra empresa.

**A branch `main`, os Workers remotos e os bancos de produção permanecem fora do escopo desta rodada.**
