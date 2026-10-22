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


## Troca obrigatória da senha inicial — novo controle

A migração local `0024_company_admin_first_password.sql` acrescenta `must_change_password` a cada administrador, com valor inicial **1 (troca pendente)**. A migração não muda senhas, nem altera dados de funcionários, registros de ponto ou escalas.

Ao entrar em `/empresa/entrar`, o gestor precisa usar a senha inicial para autenticar-se. A sessão devolve `must_change_password=true` sem expor hashes ou outros segredos. Enquanto houver troca pendente, todas as rotas protegidas pelo middleware `requireCompanyAdmin` (incluindo listagem de funcionários e configuração/atribuição de jornadas) ficam bloqueadas, mesmo para requisições diretas à API.

A tela obriga o gestor a informar **senha atual, nova senha com 12 a 128 caracteres e confirmação**. A API `POST /api/company/auth/change-password` exige autenticação válida e proteção CSRF, aplica limite de tentativas, verifica a senha atual e rejeita reutilização da mesma senha. A nova senha é armazenada apenas como hash com salt; nenhuma senha é escrita em texto claro no banco. A alteração incrementa `auth_version`, revoga todas as sessões desse gestor **somente na empresa correspondente** e exige login com a nova senha.

Eventos de segurança ficam na tabela isolada `company_admin_security_events`, contendo apenas identificadores de empresa/gestor, tipo de alteração e data — sem senha nem token. Alterações não podem ser lançadas na empresa errada por causa da restrição D1.

**Teste:** `tests/company-admin-password-change.test.ts` cobre os bloqueios de primeira senha, acesso a jornadas, CSRF, troca e revogação. `tests/d1-company-admin-password.test.ts` cria duas empresas fictícias no D1 local e garante isolamento.

**Pendências para operação:** aprovação de fluxo seguro de recuperação de contas, validação no Worker/D1 exclusivos de homologação, testes sob concorrência e revisão de política de credenciais e auditoria. O formulário funcional **não está ativo na Cloudflare Pages estática**. Nenhum banco remoto foi migrado.


## Recuperação assistida de senha por meio do Superadmin

O código da branch acrescenta o botão **Redefinir senha** na janela **Administradores**, dentro de cada empresa. Como ainda não existe provedor de e-mail verificado, **não há recuperação automática por e-mail** ou WhatsApp, nem botão de recuperação sem autenticação.

O fluxo de homologação é:
1. O Superadmin entra em sessão própria e abre os administradores de uma empresa ativa.
2. Seleciona um responsável **ativo** daquela mesma empresa e confirma a operação.
3. A API `POST /api/platform/companies/:id/admins/:adminId/reset-password` exige sessão válida do Superadmin, proteção CSRF e limite de dez redefinições por hora por administrador/IP. Gera senha provisória aleatória criptograficamente (96 bits), armazenando **apenas o hash**; marca `must_change_password=1`, incrementa `auth_version`, encerra sessões antigas e registra o evento `company_admin.password_reset` na auditoria da plataforma, sem senha ou token nos detalhes.
4. **Somente a resposta daquela solicitação** fornece a senha provisória ao Superadmin. A resposta tem cabeçalhos `Cache-Control: private, no-store` e `Pragma: no-cache`. A tela mostra e permite copiar o valor, mas remove-o da memória visível ao ocultar ou fechar; não envia automaticamente a senha a terceiros.
5. A senha provisória é válida por **24 horas**, usando o campo `temporary_password_expires_at` da migração local **0025**. Senhas expiradas não autenticam. Antes do vencimento, o gestor entra, informa essa senha e é obrigado a substituí-la por outra com pelo menos 12 caracteres; a troca limpa o vencimento, revoga sessões e exige login novamente.

Não se pode redefinir senha de gestor suspenso ou de empresa inativa. Nenhuma operação aceita `company_id` de uma sessão empresarial na rota Superadmin: os alvos `companyId` e `adminId` são verificados juntos no D1. A recuperação assistida não permite visualizar a senha antiga.

**Limitações para produção:** validar entrega segura do segredo ao destinatário correto, política de contas e privilégios, histórico de auditoria, alertas sobre redefinição e testes de ponta a ponta no Worker e D1 de homologação. A prévia estática Pages não oferece login real. Nenhum deploy remoto ou migração em produção foi feito.

## Concorrência de credenciais e sessões (auditoria adicional)

A migração **0026_company_admin_atomic_writes.sql** adiciona uma tabela de guarda
sem dados pessoais. Troca de senha, recuperação assistida e mudança de situação
de gestor verificam `changes()` imediatamente após a alteração otimista, dentro
do mesmo batch D1. Conflitos abortam tudo antes de revogação e auditoria; falhas
posteriores também revertem a senha. A guarda é removida no batch bem-sucedido.

O login cria sessões com `INSERT ... SELECT`, revalidando empresa ativa, gestor
ativo, versão das credenciais, hash verificado e validade de senha provisória.
Se esses dados mudarem durante a verificação da senha, não emite cookie.

Testes de integração locais com Miniflare/D1 e senha scrypt real:
`tests/d1-company-admin-atomic-write.test.ts` e
`tests/d1-company-login-race.test.ts`. Nenhuma instância remota é usada.
Não aplicar migração 0026, fazer deploy ou habilitar recursos sem homologação
isolada e autorização explícita do proprietário.
