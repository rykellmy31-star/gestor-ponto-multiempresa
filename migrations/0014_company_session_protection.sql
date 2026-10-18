
-- CR JORNADA
-- Protege a identidade das sessoes empresariais.
-- Nao altera sessoes existentes.

CREATE TRIGGER company_admin_sessions_identity_immutable
BEFORE UPDATE OF company_id, admin_id, token_hash
ON company_admin_sessions
BEGIN
  SELECT RAISE(ABORT, 'company_session_identity_immutable');
END;

-- Impede que um administrador seja transferido
-- de uma empresa para outra.

CREATE TRIGGER company_admins_company_immutable
BEFORE UPDATE OF company_id
ON company_admins
BEGIN
  SELECT RAISE(ABORT, 'company_admin_company_immutable');
END;
