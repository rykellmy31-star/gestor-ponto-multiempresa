# Backup, restauração e recuperação

**Responsável:** operador autorizado da conta Cloudflare. Os comandos remotos exigem autenticação própria. Não forneça API token ou frase de backup a terceiros/chat. Backups contêm dados pessoais, hashes de senhas, sessões e histórico trabalhista; a proteção deve ser tão forte quanto a do banco em uso.

## 1. O que deve ser guardado

Mantenha em locais separados:

1. Backup `.jdb` cifrado e seu `.manifest.json`, em armazenamento com controle de acesso e cópia externa.
2. Frase forte de proteção do backup, em cofre, **não junto do arquivo**.
3. `AUTH_PEPPER` e `DATA_KEY` originais, no cofre. A restauração do SQL não recupera Secrets do Worker.
4. Código/lockfile/migrations correspondentes à versão, configuração do domínio e identificador do D1.

Perder `AUTH_PEPPER` impede verificar senhas existentes. Perder `DATA_KEY` impede recuperar CPFs cifrados. Não “resolva” recriando chaves sem planejamento de migração/recuperação de contas.

Defina periodicidade, retenção, cópia geograficamente separada e responsáveis conforme o risco e a obrigação trabalhista/LGPD. Não confunda o prazo curto do Time Travel com um arquivo histórico de longo prazo.

## 2. Backup cifrado incluído

Local, explicitamente:

```bash
npm run backup -- --local
```

Produção, na conta e configuração certas:

```bash
npm run backup -- --remote
```

O programa pede uma frase com **mínimo de 16 caracteres** em terminal privado, sem eco, e confirmação. Prefira uma frase longa aleatória. Não a passe como argumento, não a salve em histórico de comandos.

- Formato versionado `JORNADABK1`: AES-256-GCM autenticado, salt aleatório, nonce aleatório e chave derivada por scrypt N=32768, r=8, p=3.
- Saída: `backups/jornada-local-...jdb` ou `jornada-remote-...jdb` e manifesto com SHA-256 do arquivo cifrado, tamanho, data e modo. Manifesto não contém chaves.
- Exportação remota usa o comando oficial `wrangler d1 export DB --remote`. Pode bloquear consultas enquanto é produzida: programe janela fora das batidas.
- O Wrangler 4 usado aqui **não aceita `--persist-to` em `d1 export`**. Por isso o modo local usa `node:sqlite` em leitura/snapshot transacional no diretório `.data/v3/d1`, incluindo tabelas, dados, índices e triggers. Não assume que `.wrangler/state` é seu banco.
- Para outro diretório local: `npm run backup -- --local --persist-to .test-data --config wrangler.test.jsonc`. Isso é útil só em homologação/testes.
- A cifra e sua verificação usam streams; não é preciso carregar o dump inteiro em memória.
- O SQL claro temporário é criado em pasta restrita dentro de `backups/` e removido ao final. Exclusão de arquivo não garante apagamento forense em SSD/cloud: use volume/estação cifrados e política adequada.

Para automação, injete `BACKUP_PASSWORD` pelo **cofre do executor**, sem imprimi-la. Configure também a autenticação Cloudflare restrita necessária. Nunca grave senha/token no agendador em texto público. O script **não instala um cron por conta própria**; agende a execução e alerte falhas conforme sua infraestrutura.

## 3. Testar e restaurar em NOVO banco vazio

1. Preserve o banco atual e o backup original. Escolha uma janela sem gravações.
2. Em máquina/volume protegido, descriptografe:

```bash
node scripts/decrypt-backup.mjs backups/ARQUIVO_REAL.jdb restauracao.sql
```

O destino não pode existir. Uma frase incorreta ou arquivo adulterado não disponibiliza um SQL final de restauração. O formato tem autenticação GCM, não apenas uma senha para “ocultar” o conteúdo.

3. Crie **outro D1**, por exemplo:

```bash
npx wrangler d1 create jornada-restauracao
```

4. Importe no **nome real do novo banco vazio**, nunca por engano no banco ativo:

```bash
npx wrangler d1 execute jornada-restauracao --remote --file=restauracao.sql
```

**Não aplique primeiro as migrations de instalação em um destino de backup completo**: o dump já contém esquema, dados e registro de migrations. Não importe por cima de tabelas existentes. Respeite a versão do código correspondente ao backup; migrations posteriores devem ser revisadas depois da restauração.

5. Faça verificações na configuração de homologação vinculada ao novo banco:

```sql
PRAGMA foreign_key_check;
SELECT COUNT(*) AS funcionarios FROM employees;
SELECT COUNT(*) AS marcas FROM punches;
SELECT COUNT(*) AS fechamentos FROM monthly_closures;
SELECT COUNT(*) AS versoes FROM closure_snapshots;
SELECT name FROM sqlite_master WHERE type='trigger';
```

6. Confira amostras de datas, turnos noturnos, folhas fechadas e hashes; login/reset de senha com os Secrets corretos; PDF/CSV e auditoria. Compare contagens com o relatório registrado na época do backup.
7. Só após aprovação mude `database_id`/nome no vínculo **DB** da configuração de produção e publique na janela planejada. Não altere o banco apenas para “ver se funciona”.
8. Em recuperação de incidente de segurança, revogue sessões e links restaurados antes da reabertura. Na conta autorizada e no banco correto: `DELETE FROM sessions; DELETE FROM password_reset_tokens;`. O operador deve registrar externamente o incidente/procedimento, preservando auditoria e evidências.
9. Elimine o SQL temporário de forma compatível com o meio de armazenamento; não o envie por e-mail, não o coloque no repositório e não o deixe na pasta de downloads compartilhada.

**Validação realizada na entrega:** exportação local real, cifra, descriptografia, restauração em SQLite separado, `foreign_key_check` sem erros, presença de pontos/triggers e recusa de frase errada. **A restauração em D1 remoto não foi executada** e é obrigatória como ensaio antes do uso produtivo.

## 4. Time Travel nativo do D1

Segundo a documentação Cloudflare consultada na entrega, a janela é **7 dias no plano Free / 30 dias no Paid**. Confirme a quota da sua conta. Time Travel é recuperação pontual, não exportação externa nem cópia arquivada permanente.

Consultar bookmark atual (use o nome real se você mudou o banco):

```bash
npx wrangler d1 time-travel info jornada-db
```

Consultar um instante pode ser feito com `--timestamp=INSTANTE_RFC3339_REAL`. Para restaurar, selecione cuidadosamente um bookmark retornado pelo comando/documentação:

```bash
npx wrangler d1 time-travel restore jornada-db --bookmark=BOOKMARK_REAL_ESCOLHIDO
```

**Essa operação restaura o banco em uso, não cria um clone**, e pode cancelar consultas em andamento. Bloqueie o acesso operacional na borda/procedimento da empresa, obtenha backup/bookmark atual, confira conta/banco/instante e planeje reconciliação dos pontos posteriores ao instante restaurado. Guarde o bookmark de desfazer informado pela Cloudflare. Não execute comandos destrutivos em modo de tentativa.

Documentação oficial: [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [importar/exportar](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [limites](https://developers.cloudflare.com/d1/platform/limits/).

## 5. Recuperação normal de funcionários/administradores

Pelo app: **Esqueci a senha → validação de identidade pelo responsável → emissão de link no painel**, ou e-mail automático opcional. Link de uso único de 30 minutos; o token é guardado no banco somente como SHA-256. A nova senha revoga sessões anteriores.

Não use acesso direto ao SQL para inserir uma senha em texto puro. Isso não é suportado e não cria um hash válido.

## 6. Único administrador sem acesso — recuperação operacional

Somente um operador autenticado na conta Cloudflare deve executar em **terminal privado**:

```bash
npm run admin:recover -- --remote --login USUARIO_ADMINISTRATIVO_REAL
```

- O comando aceita somente **administrador já existente**. Não cria novas contas, não aceita promover funcionário e não abre um endpoint público.
- Cria token aleatório de uso único, com hash e prazo de 30 minutos. Invalida links anteriores desse usuário e registra `auth.operational_reset_issued` na auditoria.
- Mostra o link apenas no terminal do operador. Valide a identidade e entregue por canal privado. Não encaminhe o terminal para logs de CI ou chat.
- Use o link em `/redefinir-senha#token=...`, defina a nova senha e entre em `/admin/entrar`.
- Se a conta está bloqueada, o script recusa. Após validação adicional explícita, `--reactivate` reativa e registra essa decisão. Não use esse sinalizador só para contornar um bloqueio legítimo.
- Localmente: `--local`; o alvo padrão é `.data`. Homologação pode indicar `--config` e `--persist-to` explicitamente.

Não há senha de emergência padrão ou conta secreta. Se a própria conta Cloudflare foi perdida, recupere-a pelos procedimentos oficiais do provedor; a aplicação não possui uma porta dos fundos.

## 7. Manutenção de dados temporários

Pontos e auditoria não devem ser apagados pelo uso normal. Sessões, tokens de reset e baldes de rate limit expirados podem ser limpos pelo operador após revisar a política de retenção; a aplicação já os considera inválidos por prazo/versão, mesmo enquanto a linha existir. Não foi instalado um cron de limpeza automática. Monitore crescimento, quotas, falhas de backup e logs sem registrar corpos de login, cookies ou links de reset.
