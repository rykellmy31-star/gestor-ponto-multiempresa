-- CR JORNADA 0033 — candidate ONLY; local SQLite/D1 homologation required.
-- Protect five historical schedule tables from SQLite implicit DELETE in
-- INSERT OR REPLACE/REPLACE INTO when recursive_triggers=OFF (the default).
-- Original BEFORE DELETE/UPDATE triggers in 0001/0004/0006/0019 do not
-- reliably prevent implicit deletion caused by REPLACE.
-- No existing rows, foreign keys or indexes are changed by this migration.
-- Each table has exactly one uniqueness constraint involved here: its PK.
-- Duplicate-key INSERT ... DO NOTHING is also rejected intentionally.
-- Normal new INSERTs, authorized schedule UPDATEs and insertions after
-- legitimate assignment cancellations remain permitted.

CREATE TRIGGER schedules_no_implicit_replacement
BEFORE INSERT ON schedules
WHEN EXISTS (SELECT 1 FROM schedules WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'schedule_version_immutable'); END;

CREATE TRIGGER schedule_assignments_no_implicit_replacement
BEFORE INSERT ON schedule_assignments
WHEN EXISTS (SELECT 1 FROM schedule_assignments WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'assignment_immutable'); END;

CREATE TRIGGER schedule_assignment_cancellations_no_implicit_replacement
BEFORE INSERT ON schedule_assignment_cancellations
WHEN EXISTS (
  SELECT 1 FROM schedule_assignment_cancellations
  WHERE assignment_id=NEW.assignment_id
)
BEGIN SELECT RAISE(ABORT, 'cancellation_immutable'); END;

CREATE TRIGGER schedule_history_no_implicit_replacement
BEFORE INSERT ON schedule_history
WHEN EXISTS (SELECT 1 FROM schedule_history WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'schedule_history_immutable'); END;

CREATE TRIGGER company_schedule_audit_no_implicit_replacement
BEFORE INSERT ON company_schedule_audit
WHEN EXISTS (SELECT 1 FROM company_schedule_audit WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'schedule_audit_immutable'); END;
