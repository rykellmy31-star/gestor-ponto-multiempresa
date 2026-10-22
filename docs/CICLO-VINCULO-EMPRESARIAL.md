# Situação do vínculo empresarial

`POST /api/company/employees/:id/status`, sob a flag opt-in do cadastro empresarial, exige sessão empresarial, origem, CSRF, senha atual do gestor, motivo e `expected_updated_at`. Empresa, usuário e administrador nunca são aceitos como destino no corpo.

Transições: ativo → bloqueado; bloqueado → ativo; ativo/bloqueado → desligado. O desligamento exige data entre a admissão e o dia atual na timezone da empresa, sem ponto posterior e sem jornada iniciada incompleta. Dados antigos sem empresa comprovada impedem o desligamento até reconciliação. Desligado não volta a ativo por esta operação; recontratação com novo período ainda precisa de implementação própria.

Uma transação compara a versão do funcionário, revalida o gestor e sua senha, empresa ativa, versão da credencial do funcionário e compatibilidade dos dias de ponto. Então atualiza a situação, altera o acesso do usuário, incrementa auth_version, remove as sessões exclusivas daquele vínculo e grava `company.employee.status_changed` em audit_log, com empresa, gestor, motivo e estado anterior/novo. Falha da auditoria desfaz todo o conjunto. Seleções CPF antigas também deixam de valer pela versão da credencial. Nenhuma sessão de outro vínculo ou empresa é removida.

Bloquear permite suspender o acesso mesmo com dia aberto, que deverá ser completado após reativação. Desligar não apaga ou altera punches, work_days, jornadas e configurações congeladas. A reativação exige novo login. Não altera senha, CPF, matrícula ou admissão.

Testes D1 locais incluem A/B, CSRF, senha incorreta, concorrência, sessão antiga após reativação, data futura/retroativa, dia aberto, legado sem empresa e rollback da auditoria. O roteiro remoto testa bloqueio/reativação/desligamento pelo painel, novo login CPF e preservação dos pontos, com dados fictícios apenas no staging. Não houve nova migration.
