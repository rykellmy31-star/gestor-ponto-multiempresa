-- CR JORNADA 0021 — pagina de vendas configuravel pelo Superadmin.
-- Rascunho separado da versao publica: editar nunca altera a pagina
-- publica antes de uma acao explicita de publicacao.
-- Somente D1 local ate homologacao especifica do backend.

CREATE TABLE sales_page_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  draft_json TEXT NOT NULL
    CHECK(json_valid(draft_json) AND json_type(draft_json) = 'object'),
  published_json TEXT
    CHECK(published_json IS NULL OR json_valid(published_json)),
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  updated_by TEXT NOT NULL REFERENCES platform_admins(id),
  updated_at INTEGER NOT NULL
);

CREATE TRIGGER sales_page_audit_insert
AFTER INSERT ON sales_page_settings
BEGIN
  INSERT INTO platform_audit_log(
    id,actor_id,action,entity_type,entity_id,details_json,created_at
  ) VALUES (
    lower(hex(randomblob(16))),NEW.updated_by,
    CASE WHEN NEW.published=1 THEN 'sales_page.published'
         ELSE 'sales_page.draft_saved' END,
    'sales_page','1',
    json_object('revision',NEW.revision,'published',NEW.published),
    NEW.updated_at
  );
END;

CREATE TRIGGER sales_page_audit_update
AFTER UPDATE ON sales_page_settings
BEGIN
  INSERT INTO platform_audit_log(
    id,actor_id,action,entity_type,entity_id,details_json,created_at
  ) VALUES (
    lower(hex(randomblob(16))),NEW.updated_by,
    CASE
      WHEN OLD.published=1 AND NEW.published=0 THEN 'sales_page.unpublished'
      WHEN NEW.published_json IS NOT OLD.published_json THEN 'sales_page.published'
      ELSE 'sales_page.draft_saved'
    END,
    'sales_page','1',
    json_object(
      'revision',NEW.revision,'previous_revision',OLD.revision,
      'published',NEW.published
    ),
    NEW.updated_at
  );
END;
