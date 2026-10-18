-- CR JORNADA: configurações individuais por empresa.
-- Migração aditiva: não altera nem remove tabelas e registros legados.
-- Executar somente após 0001..0010 em banco de TESTE.

CREATE TABLE company_settings (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'America/Bahia'
    CHECK(timezone IN ('America/Bahia', 'America/Sao_Paulo')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO company_settings(company_id, display_name, timezone, updated_at)
SELECT id, name, timezone, unixepoch() * 1000
FROM companies;

CREATE TRIGGER company_settings_provision
AFTER INSERT ON companies
BEGIN
  INSERT INTO company_settings(company_id, display_name, timezone, updated_at)
  VALUES(NEW.id, NEW.name, NEW.timezone, unixepoch() * 1000);
END;

CREATE TRIGGER company_settings_timezone_sync
AFTER UPDATE OF timezone ON companies
WHEN NEW.timezone <> OLD.timezone
BEGIN
  UPDATE company_settings
  SET timezone = NEW.timezone, updated_at = unixepoch() * 1000
  WHERE company_id = NEW.id;
END;

CREATE TRIGGER company_settings_no_delete
BEFORE DELETE ON company_settings
BEGIN
  SELECT RAISE(ABORT, 'company_settings_no_delete');
END;
