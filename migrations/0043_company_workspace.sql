-- New tenant-owned workspace data. No legacy survey/request data is imported.
CREATE TABLE company_employee_moods (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id),
 employee_id TEXT NOT NULL REFERENCES employees(id),
 work_date TEXT NOT NULL,
 mood TEXT NOT NULL CHECK(mood IN ('very_happy','good','neutral','sad','stressed')),
 created_at INTEGER NOT NULL,
 UNIQUE(company_id,employee_id,work_date)
);
CREATE TABLE company_employee_requests (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id),
 employee_id TEXT NOT NULL REFERENCES employees(id),
 work_date TEXT NOT NULL,
 message TEXT NOT NULL CHECK(length(message) BETWEEN 3 AND 2000),
 created_at INTEGER NOT NULL,
 UNIQUE(company_id,employee_id,work_date,message)
);
CREATE TABLE company_request_decisions (
 request_id TEXT PRIMARY KEY REFERENCES company_employee_requests(id),
 company_id TEXT NOT NULL REFERENCES companies(id),
 admin_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
 response TEXT NOT NULL CHECK(length(response) BETWEEN 3 AND 1000),
 created_at INTEGER NOT NULL,
 FOREIGN KEY(admin_id,company_id) REFERENCES company_admins(id,company_id)
);
CREATE TABLE company_workspace_audit (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id),
 admin_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='schedule.archived'),
 target_id TEXT NOT NULL REFERENCES schedules(id),
 created_at INTEGER NOT NULL,
 FOREIGN KEY(admin_id,company_id) REFERENCES company_admins(id,company_id)
);
CREATE INDEX company_requests_company_date ON company_employee_requests(company_id,created_at DESC);
CREATE INDEX company_moods_company_date ON company_employee_moods(company_id,work_date);
CREATE TRIGGER company_mood_owner BEFORE INSERT ON company_employee_moods
WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'workspace_owner'); END;
CREATE TRIGGER company_request_owner BEFORE INSERT ON company_employee_requests
WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'workspace_owner'); END;
CREATE TRIGGER company_decision_owner BEFORE INSERT ON company_request_decisions
WHEN NOT EXISTS(SELECT 1 FROM company_employee_requests WHERE id=NEW.request_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'workspace_owner'); END;
CREATE TRIGGER company_archive_owner BEFORE INSERT ON company_workspace_audit
WHEN NOT EXISTS(SELECT 1 FROM schedules WHERE id=NEW.target_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'workspace_owner'); END;
CREATE TRIGGER company_employee_moods_no_update BEFORE UPDATE ON company_employee_moods
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_employee_moods_no_delete BEFORE DELETE ON company_employee_moods
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_employee_requests_no_update BEFORE UPDATE ON company_employee_requests
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_employee_requests_no_delete BEFORE DELETE ON company_employee_requests
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_request_decisions_no_update BEFORE UPDATE ON company_request_decisions
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_request_decisions_no_delete BEFORE DELETE ON company_request_decisions
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_workspace_audit_no_update BEFORE UPDATE ON company_workspace_audit
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_workspace_audit_no_delete BEFORE DELETE ON company_workspace_audit
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_employee_moods_no_replace BEFORE INSERT ON company_employee_moods
WHEN EXISTS(SELECT 1 FROM company_employee_moods WHERE id=NEW.id OR (company_id=NEW.company_id AND employee_id=NEW.employee_id AND work_date=NEW.work_date))
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_employee_requests_no_replace BEFORE INSERT ON company_employee_requests
WHEN EXISTS(SELECT 1 FROM company_employee_requests WHERE id=NEW.id OR (company_id=NEW.company_id AND employee_id=NEW.employee_id AND work_date=NEW.work_date AND message=NEW.message))
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_request_decisions_no_replace BEFORE INSERT ON company_request_decisions
WHEN EXISTS(SELECT 1 FROM company_request_decisions WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;
CREATE TRIGGER company_workspace_audit_no_replace BEFORE INSERT ON company_workspace_audit
WHEN EXISTS(SELECT 1 FROM company_workspace_audit WHERE id=NEW.id OR (company_id=NEW.company_id AND target_id=NEW.target_id))
BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END;

CREATE UNIQUE INDEX company_archive_once ON company_workspace_audit(company_id,target_id);
