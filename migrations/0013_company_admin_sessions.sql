-- Sessoes isoladas para administradores das empresas.
-- Nao habilita as rotas legadas de funcionarios e ponto.
CREATE TABLE company_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  admin_id TEXT NOT NULL REFERENCES company_admins(id) ON DELETE RESTRICT,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX company_admin_sessions_admin ON company_admin_sessions(admin_id);
CREATE INDEX company_admin_sessions_company ON company_admin_sessions(company_id);
CREATE TRIGGER company_admin_sessions_company_guard
BEFORE INSERT ON company_admin_sessions
WHEN NOT EXISTS (SELECT 1 FROM company_admins a WHERE a.id = NEW.admin_id AND a.company_id = NEW.company_id)
BEGIN SELECT RAISE(ABORT, 'company_admin_mismatch'); END;
