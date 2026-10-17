
-- CR JORNADA
-- Estrutura inicial da plataforma multiempresas.
-- Ainda não altera as tabelas de ponto existentes.

CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  platform_name TEXT NOT NULL DEFAULT 'CR JORNADA',
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#0F766E',
  updated_at INTEGER NOT NULL
);

INSERT INTO platform_settings (
  id, platform_name, primary_color, updated_at
) VALUES (
  1, 'CR JORNADA', '#0F766E', unixepoch() * 1000
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#0F766E',
  timezone TEXT NOT NULL DEFAULT 'America/Bahia'
    CHECK (timezone IN ('America/Bahia', 'America/Sao_Paulo')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX companies_status
ON companies(status);

CREATE TABLE platform_admins (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE platform_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  reauth_at INTEGER NOT NULL DEFAULT 0,
  auth_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX platform_sessions_admin
ON platform_sessions(admin_id);

CREATE TABLE platform_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES platform_admins(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  created_at INTEGER NOT NULL
);

CREATE INDEX platform_audit_created
ON platform_audit_log(created_at DESC);
