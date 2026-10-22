# Edição cadastral empresarial

`PATCH /api/company/employees/:id` permite editar nome e cargo, com a mesma flag opt-in do cadastro empresarial. Empresa e administrador são derivados da sessão; CSRF e origem continuam obrigatórios. Não aceita identificadores de empresa no corpo nem parâmetros de consulta.

O cliente envia `expected_updated_at`. A alteração usa comparação otimista, timestamp monotônico e revalidação da sessão/empresa no próprio SQL. Atualização do funcionário, nome de exibição do usuário e auditoria são atômicas; falha da auditoria desfaz o conjunto. O evento `company.employee.profile_updated` em `audit_log` contém empresa, administrador e valores anteriores/novos, sem credenciais ou CPF. O actor_id legado fica NULL porque administradores empresariais pertencem a outra tabela.

O painel mostra “Editar nome e cargo”. Se a resposta for incerta, exige atualizar a lista antes de salvar de novo. CPF, matrícula, status, admissão, desligamento, escalas e marcações não são alterados por esta operação. Nome e cargo são metadados atuais; esta etapa não certifica identificação histórica em documentos já emitidos nem fechamento definitivo.

Testes D1 cobrem empresas A/B, CSRF, campos extras, conflito de versão, sincronização do nome e rollback em falha de auditoria. A homologação real edita pelo navegador e confere API e auditoria diretamente no D1. Sem nova migration e sem alteração de produção.
