-- CR JORNADA 0021 — pagina de vendas editavel pelo Superadmin.
-- Estrutura isolada da gestao de jornada e de dados das empresas.
-- Executar exclusivamente em D1 local ate aprovacao de staging.

CREATE TABLE sales_page_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json) = 'object'),
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  updated_by TEXT NOT NULL REFERENCES platform_admins(id),
  updated_at INTEGER NOT NULL
);

-- Toda publicacao/edicao e registrada no log do Superadmin no mesmo
-- commit D1. Nao armazena segredos nem credenciais.
CREATE TRIGGER sales_page_audit_insert
AFTER INSERT ON sales_page_settings
BEGIN
  INSERT INTO platform_audit_log (
    id, actor_id, action, entity_type, entity_id, details_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.updated_by,
    CASE WHEN NEW.published = 1 THEN 'sales_page.published'
         ELSE 'sales_page.draft_saved' END,
    'sales_page', '1',
    json_object('revision', NEW.revision, 'published', NEW.published),
    NEW.updated_at
  );
END;

CREATE TRIGGER sales_page_audit_update
AFTER UPDATE ON sales_page_settings
BEGIN
  INSERT INTO platform_audit_log (
    id, actor_id, action, entity_type, entity_id, details_json, created_at
  ) VALUES (
    lower(hex(randomblob(16))), NEW.updated_by,
    CASE WHEN NEW.published = 1 THEN 'sales_page.published'
         ELSE 'sales_page.draft_saved' END,
    'sales_page', '1',
    json_object('revision', NEW.revision, 'published', NEW.published,
      'previous_revision', OLD.revision),
    NEW.updated_at
  );
END;
