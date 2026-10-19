-- CR JORNADA 0024 — troca de senha inicial dos gestores empresariais.
-- Aditiva. Não altera registros de ponto, escalas ou empresas legadas.
-- Default 1: gestores de testes já existentes devem atualizar a senha
-- ao entrar novamente. Não executa alterações em D1 remoto.
ALTER TABLE company_admins
  ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK(must_change_password IN (0,1));

CREATE TABLE company_admin_security_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  admin_id TEXT NOT NULL REFERENCES company_admins(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('password_changed')),
  created_at INTEGER NOT NULL
);

CREATE INDEX company_admin_security_events_company
  ON company_admin_security_events(company_id, created_at DESC);

CREATE TRIGGER company_admin_security_events_company_guard
BEFORE INSERT ON company_admin_security_events
WHEN NOT EXISTS (
  SELECT 1 FROM company_admins
  WHERE id = NEW.admin_id AND company_id = NEW.company_id
)
BEGIN SELECT RAISE(ABORT, 'company_admin_security_event_mismatch'); END;
