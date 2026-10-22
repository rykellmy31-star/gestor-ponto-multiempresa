-- CR JORNADA 0034 — LOCAL-ONLY candidate; D1 validation required before merge.
-- Follow 0027 and candidate 0033. No data copy, table rebuild or UPDATE.
-- SQLite INSERT OR REPLACE can silently erase an existing row without firing
-- BEFORE DELETE when recursive_triggers=OFF. Prevent the replacement BEFORE
-- SQLite resolves either a PRIMARY KEY or secondary UNIQUE collision.
-- Duplicate-key ON CONFLICT DO NOTHING is intentionally rejected for these
-- append-only ledgers. Do NOT apply remotely until application/D1 validation.

-- Both the rule ID and its effective date are globally unique.
CREATE TRIGGER rule_versions_no_implicit_replacement
BEFORE INSERT ON rule_versions
WHEN EXISTS (SELECT 1 FROM rule_versions r
             WHERE r.id=NEW.id OR r.effective_from=NEW.effective_from)
BEGIN SELECT RAISE(ABORT,'rule_version_immutable'); END;

CREATE TRIGGER adjustments_no_implicit_replacement
BEFORE INSERT ON adjustments
WHEN EXISTS (SELECT 1 FROM adjustments a WHERE a.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'adjustment_immutable'); END;

-- A closure snapshot has two independent unique keys: event ID and
-- (closure_id,version). Checking only ID allows a forged new ID to erase
-- the real historical version through the composite UNIQUE constraint.
-- Overtime decisions are append-only payroll evidence. Migration 0001 guards
-- direct UPDATE/DELETE, but SQLite REPLACE can silently delete an approved
-- decision if recursive_triggers=OFF. Guard the primary-key conflict BEFORE
-- replacement, leaving legitimate distinct decisions insertable.
CREATE TRIGGER overtime_decisions_no_implicit_replacement
BEFORE INSERT ON overtime_decisions
WHEN EXISTS (SELECT 1 FROM overtime_decisions d WHERE d.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'overtime_immutable'); END;

CREATE TRIGGER closure_snapshots_no_implicit_replacement
BEFORE INSERT ON closure_snapshots
WHEN EXISTS (SELECT 1 FROM closure_snapshots s
             WHERE s.id=NEW.id OR
                   (s.closure_id=NEW.closure_id AND s.version=NEW.version))
BEGIN SELECT RAISE(ABORT,'snapshot_immutable'); END;

CREATE TRIGGER audit_log_no_implicit_replacement
BEFORE INSERT ON audit_log
WHEN EXISTS (SELECT 1 FROM audit_log a WHERE a.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'audit_immutable'); END;

-- These newer audit/security tables previously had no direct UPDATE/DELETE
-- guards. They are append-only by design: password-security and platform
-- audit history must not be editable or removable by ordinary SQL writes.
CREATE TRIGGER platform_audit_log_no_implicit_replacement
BEFORE INSERT ON platform_audit_log
WHEN EXISTS (SELECT 1 FROM platform_audit_log a WHERE a.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'platform_audit_immutable'); END;
CREATE TRIGGER platform_audit_log_no_update
BEFORE UPDATE ON platform_audit_log
BEGIN SELECT RAISE(ABORT,'platform_audit_immutable'); END;
CREATE TRIGGER platform_audit_log_no_delete
BEFORE DELETE ON platform_audit_log
BEGIN SELECT RAISE(ABORT,'platform_audit_immutable'); END;

CREATE TRIGGER company_admin_security_events_no_implicit_replacement
BEFORE INSERT ON company_admin_security_events
WHEN EXISTS (SELECT 1 FROM company_admin_security_events e WHERE e.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'company_admin_security_event_immutable'); END;
CREATE TRIGGER company_admin_security_events_no_update
BEFORE UPDATE ON company_admin_security_events
BEGIN SELECT RAISE(ABORT,'company_admin_security_event_immutable'); END;
CREATE TRIGGER company_admin_security_events_no_delete
BEFORE DELETE ON company_admin_security_events
BEGIN SELECT RAISE(ABORT,'company_admin_security_event_immutable'); END;

-- This table already has UPDATE/DELETE guards from migration 0027; complete
-- the protection against implicit DELETE during conflict replacement.
CREATE TRIGGER company_employee_security_events_no_implicit_replacement
BEFORE INSERT ON company_employee_security_events
WHEN EXISTS (SELECT 1 FROM company_employee_security_events e WHERE e.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'employee_security_event_immutable'); END;
