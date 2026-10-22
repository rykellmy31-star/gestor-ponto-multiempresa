-- Eventos empresariais versionados; nunca alteram marcações originais.
CREATE TABLE company_day_events (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id)>0),
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT,
  scope_key TEXT NOT NULL,
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('holiday','occurrence','adjustment')),
  revision INTEGER NOT NULL CHECK(revision>0),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  reason TEXT NOT NULL CHECK(length(reason)>=10),
  admin_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(employee_id,company_id) REFERENCES employees(id,company_id),
  FOREIGN KEY(admin_id,company_id) REFERENCES company_admins(id,company_id),
  CHECK((kind='holiday' AND employee_id IS NULL AND scope_key='company') OR
    (kind<>'holiday' AND employee_id IS NOT NULL AND scope_key='employee:'||employee_id)),
  UNIQUE(company_id,scope_key,work_date,kind,revision)
);
CREATE INDEX company_day_events_month ON company_day_events(company_id,work_date,employee_id);
CREATE TRIGGER company_day_events_owner BEFORE INSERT ON company_day_events
WHEN NOT EXISTS(SELECT 1 FROM company_admins WHERE id=NEW.admin_id AND company_id=NEW.company_id)
  OR (NEW.employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id))
BEGIN SELECT RAISE(ABORT,'day_event_company_mismatch'); END;
CREATE TRIGGER company_day_events_no_replace BEFORE INSERT ON company_day_events
WHEN EXISTS(SELECT 1 FROM company_day_events WHERE id=NEW.id OR
  (company_id=NEW.company_id AND scope_key=NEW.scope_key AND work_date=NEW.work_date AND kind=NEW.kind AND revision=NEW.revision))
BEGIN SELECT RAISE(ABORT,'day_event_revision_conflict'); END;
CREATE TRIGGER company_day_events_no_update BEFORE UPDATE ON company_day_events
BEGIN SELECT RAISE(ABORT,'day_event_immutable'); END;
CREATE TRIGGER company_day_events_no_delete BEFORE DELETE ON company_day_events
BEGIN SELECT RAISE(ABORT,'day_event_immutable'); END;
