-- CR JORNADA — CANDIDATE 0031. LOCAL-ONLY, DO NOT DEPLOY REMOTELY.
-- Apply only after migration 0019 (composite reference), and candidate 0030.
-- Records the authenticated company administrator creating an employee.
CREATE TABLE company_employee_registration_audit (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action='created'),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  FOREIGN KEY(employee_id,company_id) REFERENCES employees(id,company_id),
  FOREIGN KEY(admin_id,company_id) REFERENCES company_admins(id,company_id)
);
CREATE INDEX company_employee_registration_audit_company
  ON company_employee_registration_audit(company_id,created_at DESC);

-- A separate trigger makes cross-company audit insertion fail even if a
-- connection accidentally disables foreign key enforcement.
CREATE TRIGGER company_employee_registration_audit_company_guard
BEFORE INSERT ON company_employee_registration_audit
WHEN NOT EXISTS (
  SELECT 1 FROM employees e JOIN company_admins a
    ON a.id=NEW.admin_id AND a.company_id=NEW.company_id
  WHERE e.id=NEW.employee_id AND e.company_id=NEW.company_id
)
BEGIN SELECT RAISE(ABORT,'employee_registration_audit_company_mismatch'); END;

-- SQLite allows NULL in a TEXT PRIMARY KEY for ordinary rowid tables.
-- Require a nonempty audit event identifier explicitly.
CREATE TRIGGER company_employee_registration_audit_valid_id
BEFORE INSERT ON company_employee_registration_audit
WHEN NEW.id IS NULL OR length(trim(NEW.id,char(9,10,11,12,13,32)))=0
BEGIN SELECT RAISE(ABORT,'employee_registration_audit_id_required'); END;

-- SQLite INSERT OR REPLACE can implicitly delete the row it replaces.
-- With PRAGMA recursive_triggers=OFF (default), that implicit delete does
-- not invoke our BEFORE DELETE trigger. Reject duplicate IDs BEFORE the
-- conflict algorithm can replace any existing immutable audit entry.
-- The only uniqueness constraint on this table is the primary key (id).
CREATE TRIGGER company_employee_registration_audit_no_replace
BEFORE INSERT ON company_employee_registration_audit
WHEN EXISTS (
  SELECT 1 FROM company_employee_registration_audit WHERE id=NEW.id
)
BEGIN SELECT RAISE(ABORT,'employee_registration_audit_immutable'); END;

CREATE TRIGGER company_employee_registration_audit_no_update
BEFORE UPDATE ON company_employee_registration_audit
BEGIN SELECT RAISE(ABORT,'employee_registration_audit_immutable'); END;
CREATE TRIGGER company_employee_registration_audit_no_delete
BEFORE DELETE ON company_employee_registration_audit
BEGIN SELECT RAISE(ABORT,'employee_registration_audit_immutable'); END;

-- Same CHECK-as-guard pattern as original migration 0026.
-- Must be used in a D1 batch immediately following INSERT INTO employees.
CREATE TABLE company_employee_write_guards (
  id TEXT PRIMARY KEY,
  affected_rows INTEGER NOT NULL
    CONSTRAINT company_employee_write_conflict CHECK(affected_rows=1)
);
