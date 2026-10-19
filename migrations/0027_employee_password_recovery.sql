-- Preparação aditiva; aplicar somente em banco local até autorização.
-- Não gera senhas, não redefine contas e não ativa recursos existentes.
ALTER TABLE users ADD COLUMN employee_temporary_password_expires_at INTEGER
  CHECK(employee_temporary_password_expires_at IS NULL OR
    (role='employee' AND must_change_password=1 AND employee_temporary_password_expires_at>0));

CREATE TABLE company_employee_security_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  admin_id TEXT REFERENCES company_admins(id),
  action TEXT NOT NULL CHECK(action IN ('password_reset','password_changed')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(employee_id,company_id) REFERENCES employees(id,company_id),
  FOREIGN KEY(user_id,employee_id) REFERENCES users(id,employee_id),
  CHECK((action='password_reset' AND admin_id IS NOT NULL) OR
    (action='password_changed' AND admin_id IS NULL))
);
CREATE INDEX company_employee_security_events_company
  ON company_employee_security_events(company_id,created_at DESC);
CREATE TRIGGER company_employee_security_event_admin_guard
BEFORE INSERT ON company_employee_security_events
WHEN NEW.admin_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM company_admins WHERE id=NEW.admin_id AND company_id=NEW.company_id
)
BEGIN SELECT RAISE(ABORT,'employee_security_admin_mismatch'); END;
CREATE TRIGGER company_employee_security_events_no_update
BEFORE UPDATE ON company_employee_security_events
BEGIN SELECT RAISE(ABORT,'employee_security_event_immutable'); END;
CREATE TRIGGER company_employee_security_events_no_delete
BEFORE DELETE ON company_employee_security_events
BEGIN SELECT RAISE(ABORT,'employee_security_event_immutable'); END;
