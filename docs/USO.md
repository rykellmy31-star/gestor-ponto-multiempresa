# Manual de uso

## Configurar a empresa e a jornada

1. Entre em **Acesso administrativo** (`/admin/entrar`), nunca com uma conta de funcionário.
2. Em **Configurações**, confira razão/nome da empresa, documento e fuso. Configure tolerância, arredondamento e vigência conforme o acordo aplicável, com orientação do RH.
3. Em **Jornadas e escalas → Nova jornada**, informe entrada, início/fim do intervalo, saída e dias de trabalho. O intervalo é não remunerado por padrão. Jornada noturna é aceita, desde que a sequência seja coerente e o turno dure menos de 24h.
4. Uma jornada existente não é reescrita: crie outra versão e atribua a partir da data correta. Dias já iniciados guardam jornada, fuso e regras usados na abertura.
5. Cadastre feriados aplicáveis. Não existe um calendário nacional/municipal externo sincronizado automaticamente; a empresa deve conferir suas datas locais.

## Cadastrar funcionário

1. **Funcionários → Novo funcionário**.
2. Informe nome, matrícula/código exclusivo, cargo, admissão, usuário exclusivo e senha inicial forte (12–128 caracteres). CPF e e-mail são opcionais. CPF preenchido é validado e cifrado; a listagem usa apenas máscara/final.
3. Atribua uma jornada com vigência. Sem jornada válida não é possível registrar ponto comum ou fechar o mês.
4. Entregue usuário e senha inicial por canal privado validado. O colaborador deverá trocar a senha no primeiro acesso.
5. Matrícula, usuário e e-mail compartilham um espaço de identificadores exclusivos: não pode haver ambiguidade de login entre pessoas/perfis.

**Editar** altera cadastro autorizado e gera auditoria. **Bloquear** impede login e revoga sessões, preservando todo o histórico. **Desligar** encerra o vínculo com data de desligamento. Não existe exclusão física de pessoas com ponto, nem um botão que apague o histórico.

Para mudar escala, use a ação de **atribuir jornada** e escolha a vigência. Não faça ajustes retroativos por troca silenciosa de parâmetros: use correção administrativa documentada quando necessário.

## Funcionário: registrar o ponto

1. Abra `/entrar`; use usuário, matrícula ou e-mail e sua senha.
2. Se solicitada, altere a senha inicial e entre novamente.
3. Em **Meu ponto**, use apenas o próximo botão habilitado:
   **Entrada → Saída para intervalo → Retorno do intervalo → Saída final**.
4. Aguarde a confirmação do servidor. O horário enviado pelo seu dispositivo não determina a marcação. A tela mostra o fuso configurado e o status real retornado pelo banco.
5. Com a jornada encerrada, os quatro botões permanecem bloqueados. Recarregar a página não apaga registros.

### Falha de rede ou esquecimento

- **“Registro NÃO confirmado” não significa que o ponto foi salvo.** Use **Verificar confirmação**; a mesma chave de tentativa é reenviada de forma idempotente. Se a primeira resposta se perdeu depois de gravar, o servidor devolve a marcação existente, sem duplicá-la.
- A chave temporária fica em `sessionStorage`, apenas para repetir a requisição. Isso **não é o banco de ponto**. Uma aba fechada pode perder essa chave; após reabrir, confira os registros no servidor antes de tentar uma nova marcação.
- Sem internet não há gravação offline nem retroação automática. Não há confirmação fictícia ou fila que substitua o horário de chegada ao servidor.
- Não é possível voltar à etapa anterior, escolher um horário antigo ou editar o ponto comum. Registre uma **Solicitação/justificativa** e procure o responsável.
- Um dia anterior incompleto, um dia já tratado por ajuste ou um mês fechado pode bloquear novas marcações. O administrador deve verificar, não completar os horários por suposição.

## Solicitações, atestados e ausências

Em **Minhas solicitações**, o funcionário escolhe a data, o tipo e escreve a justificativa. A solicitação entra como **pendente**. O administrador encontra-a em **Ocorrências e justificativas**, aprova/recusa com motivo e decide se há abono, quando aplicável.

- Atestado/ausência justificada com abono cobre somente o déficit previsto, sem transformar abono em horas efetivamente trabalhadas.
- Folga aprovada remove a previsão do dia.
- Solicitação pendente/recusada não gera abono.
- O sistema guarda a justificativa textual; **não recebe anexos de documentos médicos**. Não registre diagnóstico ou dado de saúde desnecessário em texto aberto.

## Administrador: conferir e corrigir

1. Em **Registros de ponto**, filtre funcionário, mês e situação.
2. Use **Corrigir** somente com a informação confirmada. Preencha horários locais, inclusive a data seguinte nos horários de um turno noturno.
3. Informe motivo objetivo (mínimo 10 caracteres). Confirme sua senha quando solicitado.
4. Horários ausentes podem continuar vazios; um ajuste explícito é uma versão tratada, não a alteração do registro original.
5. Os registros UTC originais permanecem imutáveis. A folha indica o ajuste e o PDF inclui originais em anexo quando houver tratamento.

Um ajuste invalida uma aprovação de horas positivas baseada nos horários anteriores. Confira e decida novamente. Não existe aprovação de extra implícita só porque alguém ficou além do horário: por padrão, a diferença positiva aguarda análise. A configuração de aprovação automática é explícita, versionada e desativada inicialmente.

## Folha mensal, exportação e impressão

- Funcionário: **Minha folha de ponto** (`/app/folha`). Só seus próprios dados.
- Administrador: **Folhas e relatórios** (`/admin/relatorios`), escolha funcionário e mês/ano. Há acesso direto no formato `/admin/relatorios?funcionario=ID_REAL&mes=AAAA-MM`.
- A tabela inclui todos os dias do mês, as quatro marcações, duração prevista/real, extras aprovadas, faltantes, saldo e ocorrências. Totais e resumos semanais são apurados no servidor.
- **Exportar PDF** gera PDF verdadeiro no backend, com fonte embutida, A4 paisagem, paginação, resumo e assinaturas. Observações extensas seguem em anexo completo, e não são simplesmente cortadas.
- **Imprimir** usa a folha, sem menu/painel. Se necessário selecione A4, paisagem, escala 100% e desative cabeçalhos/rodapés do navegador. A impressão pode ter paginação diferente do PDF de servidor.
- **CSV** usa UTF-8 com BOM e separador `;`, adequado à abertura em planilhas. Células potencialmente interpretadas como fórmula recebem proteção. Não há exportador `.xlsx` nativo nesta versão.
- As colunas são mantidas em área rolável no celular para não esconder informações; a página inteira não precisa ser arrastada horizontalmente.

## Fechar e reabrir o mês

1. Conclua o mês civil e o último turno noturno. Confira jornada válida para todos os dias do vínculo.
2. Resolva justificativas e horas positivas pendentes. Trate marcações incompletas de forma **explícita e justificada**, sem inventar horas.
3. Em **Folhas e relatórios → Fechar mês**, confirme sua identidade. São bloqueados mês corrente/futuro, turno em andamento, incompletos e revisões pendentes.
4. O sistema guarda snapshot versionado e SHA-256. Alterações comuns nesse período passam a ser bloqueadas pelo backend e por triggers do banco.
5. Para corrigir mês fechado, **Reabrir mês**, justificar e confirmar a senha. A versão anterior não é apagada. Faça o tratamento e feche novamente para gerar nova versão.

O hash permite verificar a integridade do snapshot; **não é assinatura digital fiscal** nem certificação jurídica do espelho.

## Recuperar e alterar senha

- **Minha conta** permite trocar a própria senha com confirmação da senha atual; as sessões antigas são revogadas.
- **Esqueci minha senha** sempre responde sem revelar se a conta existe. Sem e-mail configurado, o RH vê o pedido em Configurações e pode emitir um link de 30 minutos, após reautenticação e validação humana da identidade.
- O link é de uso único. Envie por canal privado. O token usa fragmento `#token=` e é retirado do endereço pela interface; não o copie para auditoria, prints ou logs.
- Se o único administrador perdeu acesso, o operador com autorização na conta Cloudflare usa a recuperação operacional descrita em [BACKUP-RECUPERACAO.md](BACKUP-RECUPERACAO.md).

## O que a tela não promete

O saldo aprovado não é cálculo de salário, DSR, adicional noturno, percentuais legais de horas extras ou banco formal com vencimentos e transporte automático. A revisão de ponto não substitui folha de pagamento nem avaliação jurídica. Veja [CALCULOS.md](CALCULOS.md).
