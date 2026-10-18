-- CR JORNADA: administradores por empresa.
-- Não altera as tabelas legadas nem habilita o registro de ponto.
CREATE TABLE company_admins (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  login TEXT NOT NULL COLLATE NOCASE,
  email TEXT COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(company_id, login)
);
CREATE UNIQUE INDEX company_admins_company_email ON company_admins(company_id, email) WHERE email IS NOT NULL;
CREATE INDEX company_admins_company ON company_admins(company_id, active);
CREATE TRIGGER company_admins_no_delete BEFORE DELETE ON company_admins
BEGIN SELECT RAISE(ABORT, 'company_admins_no_delete'); END;
