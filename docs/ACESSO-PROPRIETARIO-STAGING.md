# Acesso do proprietário ao Superadmin de homologação

O Worker staging está vinculado exclusivamente ao D1 staging. A migration 0042 adiciona troca obrigatória de senha, validade da senha provisória e convites de ativação cifrados. Nenhum segredo de produção é lido ou copiado.

A preparação da conta usa a sessão QA autorizada no staging para emitir convite de uma hora vinculado a um login. A chave privada de RSA-OAEP é cifrada com AES-256-GCM e o DATA_KEY do Worker, com identificação do convite como dado autenticado. Apenas a chave pública é devolvida. O cliente cifra as credenciais com uma chave AES aleatória e protege essa chave usando RSA-OAEP. A ativação exige sessão privilegiada do criador, CSRF e origem válidos; somente a posse da chave pública ou do envelope não autoriza ativar a conta.

O pedido versionado contém login, identificação da solicitação, origem staging e eventualmente envelope cifrado. Não contém senha em texto claro. A chave privada do convite é apagada atomicamente após uso; replay e envelope adulterado são recusados. A senha da conta é armazenada somente como hash scrypt, com o pepper exclusivo do staging. O convite não sobrescreve contas existentes.

A senha provisória expira em 24 horas. A sessão inicial pode consultar sua própria sessão, trocar senha e sair; as APIs administrativas recusam essa sessão até a troca. A alteração exige a senha atual, CSRF e senha nova diferente com pelo menos 12 caracteres. A transação revalida credenciais/sessão, remove a restrição, incrementa a versão de autenticação e revoga todas as sessões do usuário. A nova senha pessoal é definida pelo proprietário no seu navegador.

Verificação local aprovada: tipos, build e testes D1 com as 42 migrations, criptografia interoperável Node/Web Crypto, ativação única, adulteração, restrição de painel, troca, revogação e autenticação posterior. Fixtures de Superadmin foram atualizadas para as colunas novas, preservando o comportamento das contas anteriores (sem troca compulsória retroativa).

Esta criação de conta é somente no staging; não libera produção nem encerra os critérios pendentes de homologação. Não registrar credenciais pessoais ou envelopes decifrados nesta documentação.


Evidência do código `d5a0be5dc9160a2ea86f598f4aaec88fa90c791d`: CI `39709068691` aprovado integralmente (compilação/testes gerais e três grupos D1); homologação `39709068643`, **298 verificações reais aprovadas**, staging com **42 migrations**. Recuperação remota: **56 tabelas**, schema/hashes idênticos, SHA256/AES-256-GCM/adulteração aprovados; clone `0ed425fc-25e2-461a-8003-ca85bc5fc4a6`. Convite cifrado emitido com sucesso no Actions `39709068753`. A senha pessoal não foi usada nos testes fictícios versionados.

A ativação do proprietário é um pedido separado com envelope cifrado, sem alterar o código da aplicação. Não utilizar ou registrar a senha pessoal do proprietário em scripts de QA, screenshots ou logs.

Ativação concluída no Actions `39709756387`, pedido cifrado `2b38ff561ff7f3e4edb8295f53f1a11a6f07c15f`: conta `rykellmy` ativa no staging com troca obrigatória de senha. O servidor confirmou consumo do convite, gravação transacional da conta e restrição inicial. A senha pessoal definitiva será escolhida pelo proprietário no primeiro login; não foi definida pelo assistente. O commit do pedido altera somente o envelope cifrado, mantendo o código já aprovado em `d5a0be5`.
