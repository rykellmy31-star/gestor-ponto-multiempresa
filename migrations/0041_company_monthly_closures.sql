-- Exclusively staging until production release authorization.
CREATE TABLE company_report_clock(company_id TEXT PRIMARY KEY REFERENCES companies(id),version INTEGER NOT NULL);
INSERT INTO company_report_clock SELECT id,0 FROM companies;
CREATE TABLE company_monthly_closures(
 id TEXT NOT NULL PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id),
 employee_id TEXT NOT NULL,
 month TEXT NOT NULL CHECK(length(month)=7),
 revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(state IN ('closed','open')),
 snapshot_json TEXT CHECK(snapshot_json IS NULL OR json_valid(snapshot_json)),
 snapshot_hash TEXT,
 reason TEXT NOT NULL CHECK(length(reason)>=10),
 admin_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(employee_id,company_id) REFERENCES employees(id,company_id),
 FOREIGN KEY(admin_id,company_id) REFERENCES company_admins(id,company_id),
 UNIQUE(company_id,employee_id,month,revision),
 CHECK((state='closed' AND snapshot_json IS NOT NULL AND length(snapshot_hash)=64) OR
       (state='open' AND snapshot_json IS NULL AND snapshot_hash IS NULL))
);
CREATE INDEX company_monthly_closures_period ON company_monthly_closures(company_id,employee_id,month,revision);
CREATE TRIGGER company_closure_owner BEFORE INSERT ON company_monthly_closures
WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id)
 OR NOT EXISTS(SELECT 1 FROM company_admins WHERE id=NEW.admin_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'closure_company_mismatch'); END;
CREATE TRIGGER company_closure_sequence BEFORE INSERT ON company_monthly_closures
WHEN NEW.revision<>COALESCE((SELECT MAX(revision) FROM company_monthly_closures WHERE company_id=NEW.company_id AND employee_id=NEW.employee_id AND month=NEW.month),0)+1
 OR NEW.state=COALESCE((SELECT state FROM company_monthly_closures WHERE company_id=NEW.company_id AND employee_id=NEW.employee_id AND month=NEW.month ORDER BY revision DESC LIMIT 1),'open')
 OR EXISTS(SELECT 1 FROM company_monthly_closures WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'closure_revision_conflict'); END;
CREATE TRIGGER company_closure_no_update BEFORE UPDATE ON company_monthly_closures
BEGIN SELECT RAISE(ABORT,'closure_immutable'); END;
CREATE TRIGGER company_closure_no_delete BEFORE DELETE ON company_monthly_closures
BEGIN SELECT RAISE(ABORT,'closure_immutable'); END;
CREATE VIEW company_closed_periods AS SELECT c.company_id,c.employee_id,c.month FROM company_monthly_closures c
 WHERE c.state='closed' AND NOT EXISTS(SELECT 1 FROM company_monthly_closures n WHERE n.company_id=c.company_id AND n.employee_id=c.employee_id AND n.month=c.month AND n.revision>c.revision);
CREATE TRIGGER report_clock_companies_insert AFTER INSERT ON companies
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT NEW.id,1 WHERE NEW.id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_companies_update AFTER UPDATE ON companies
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.id,1 WHERE OLD.id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT NEW.id,1 WHERE NEW.id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_companies_delete AFTER DELETE ON companies
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.id,1 WHERE OLD.id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_employees_insert AFTER INSERT ON employees
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_employees_update AFTER UPDATE ON employees
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_employees_delete AFTER DELETE ON employees
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_work_days_insert AFTER INSERT ON work_days
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT COALESCE(NEW.company_id,(SELECT company_id FROM employees WHERE id=NEW.employee_id)),1 WHERE COALESCE(NEW.company_id,(SELECT company_id FROM employees WHERE id=NEW.employee_id)) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_work_days_update AFTER UPDATE ON work_days
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT COALESCE(OLD.company_id,(SELECT company_id FROM employees WHERE id=OLD.employee_id)),1 WHERE COALESCE(OLD.company_id,(SELECT company_id FROM employees WHERE id=OLD.employee_id)) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT COALESCE(NEW.company_id,(SELECT company_id FROM employees WHERE id=NEW.employee_id)),1 WHERE COALESCE(NEW.company_id,(SELECT company_id FROM employees WHERE id=NEW.employee_id)) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_work_days_delete AFTER DELETE ON work_days
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT COALESCE(OLD.company_id,(SELECT company_id FROM employees WHERE id=OLD.employee_id)),1 WHERE COALESCE(OLD.company_id,(SELECT company_id FROM employees WHERE id=OLD.employee_id)) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_punches_insert AFTER INSERT ON punches
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_punches_update AFTER UPDATE ON punches
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_punches_delete AFTER DELETE ON punches
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedules_insert AFTER INSERT ON schedules
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedules_update AFTER UPDATE ON schedules
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedules_delete AFTER DELETE ON schedules
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_history_insert AFTER INSERT ON schedule_history
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM schedules WHERE id=NEW.schedule_id),1 WHERE (SELECT company_id FROM schedules WHERE id=NEW.schedule_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_history_update AFTER UPDATE ON schedule_history
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM schedules WHERE id=OLD.schedule_id),1 WHERE (SELECT company_id FROM schedules WHERE id=OLD.schedule_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM schedules WHERE id=NEW.schedule_id),1 WHERE (SELECT company_id FROM schedules WHERE id=NEW.schedule_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_history_delete AFTER DELETE ON schedule_history
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM schedules WHERE id=OLD.schedule_id),1 WHERE (SELECT company_id FROM schedules WHERE id=OLD.schedule_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_assignments_insert AFTER INSERT ON schedule_assignments
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_assignments_update AFTER UPDATE ON schedule_assignments
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_assignments_delete AFTER DELETE ON schedule_assignments
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_assignment_cancellations_insert AFTER INSERT ON schedule_assignment_cancellations
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=NEW.assignment_id),1 WHERE (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=NEW.assignment_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_assignment_cancellations_update AFTER UPDATE ON schedule_assignment_cancellations
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=OLD.assignment_id),1 WHERE (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=OLD.assignment_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=NEW.assignment_id),1 WHERE (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=NEW.assignment_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_schedule_assignment_cancellations_delete AFTER DELETE ON schedule_assignment_cancellations
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=OLD.assignment_id),1 WHERE (SELECT e.company_id FROM employees e JOIN schedule_assignments x ON x.employee_id=e.id WHERE x.id=OLD.assignment_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_punch_policy_audit_insert AFTER INSERT ON company_punch_policy_audit
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_punch_policy_audit_update AFTER UPDATE ON company_punch_policy_audit
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_punch_policy_audit_delete AFTER DELETE ON company_punch_policy_audit
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_day_events_insert AFTER INSERT ON company_day_events
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_day_events_update AFTER UPDATE ON company_day_events
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_day_events_delete AFTER DELETE ON company_day_events
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_occurrences_insert AFTER INSERT ON occurrences
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_occurrences_update AFTER UPDATE ON occurrences
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_occurrences_delete AFTER DELETE ON occurrences
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_overtime_decisions_insert AFTER INSERT ON overtime_decisions
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_overtime_decisions_update AFTER UPDATE ON overtime_decisions
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_overtime_decisions_delete AFTER DELETE ON overtime_decisions
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_monthly_closures_insert AFTER INSERT ON monthly_closures
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_monthly_closures_update AFTER UPDATE ON monthly_closures
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=NEW.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=NEW.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_monthly_closures_delete AFTER DELETE ON monthly_closures
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT company_id FROM employees WHERE id=OLD.employee_id),1 WHERE (SELECT company_id FROM employees WHERE id=OLD.employee_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_adjustments_insert AFTER INSERT ON adjustments
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_adjustments_update AFTER UPDATE ON adjustments
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=NEW.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_adjustments_delete AFTER DELETE ON adjustments
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id),1 WHERE (SELECT COALESCE(w.company_id,e.company_id) FROM work_days w JOIN employees e ON e.id=w.employee_id WHERE w.id=OLD.work_day_id) IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_monthly_closures_insert AFTER INSERT ON company_monthly_closures
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_monthly_closures_update AFTER UPDATE ON company_monthly_closures
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; INSERT INTO company_report_clock(company_id,version) SELECT NEW.company_id,1 WHERE NEW.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER report_clock_company_monthly_closures_delete AFTER DELETE ON company_monthly_closures
BEGIN INSERT INTO company_report_clock(company_id,version) SELECT OLD.company_id,1 WHERE OLD.company_id IS NOT NULL ON CONFLICT(company_id) DO UPDATE SET version=version+1; END;
CREATE TRIGGER company_closed_work_days_insert BEFORE INSERT ON work_days
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.employee_id=NEW.employee_id AND c.month=substr(NEW.work_date,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_work_days_update BEFORE UPDATE ON work_days
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.employee_id=OLD.employee_id AND c.month=substr(OLD.work_date,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_work_days_delete BEFORE DELETE ON work_days
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.employee_id=OLD.employee_id AND c.month=substr(OLD.work_date,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_punches_insert BEFORE INSERT ON punches
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE EXISTS(SELECT 1 FROM work_days w WHERE w.id=NEW.work_day_id AND w.employee_id=c.employee_id AND substr(w.work_date,1,7)=c.month))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_punches_update BEFORE UPDATE ON punches
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE EXISTS(SELECT 1 FROM work_days w WHERE w.id=OLD.work_day_id AND w.employee_id=c.employee_id AND substr(w.work_date,1,7)=c.month))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_punches_delete BEFORE DELETE ON punches
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE EXISTS(SELECT 1 FROM work_days w WHERE w.id=OLD.work_day_id AND w.employee_id=c.employee_id AND substr(w.work_date,1,7)=c.month))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_company_day_events_insert BEFORE INSERT ON company_day_events
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.company_id=NEW.company_id AND (NEW.employee_id IS NULL OR c.employee_id=NEW.employee_id) AND c.month=substr(NEW.work_date,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_company_day_events_update BEFORE UPDATE ON company_day_events
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.company_id=OLD.company_id AND (OLD.employee_id IS NULL OR c.employee_id=OLD.employee_id) AND c.month=substr(OLD.work_date,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_company_day_events_delete BEFORE DELETE ON company_day_events
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.company_id=OLD.company_id AND (OLD.employee_id IS NULL OR c.employee_id=OLD.employee_id) AND c.month=substr(OLD.work_date,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_schedule_assignments BEFORE INSERT ON schedule_assignments
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE c.employee_id=NEW.employee_id AND c.month>=substr(NEW.effective_from,1,7))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_schedule_history BEFORE INSERT ON schedule_history
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE EXISTS(SELECT 1 FROM schedule_assignments a WHERE a.schedule_id=NEW.schedule_id AND a.employee_id=c.employee_id AND c.month>=substr(NEW.effective_from,1,7)))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
CREATE TRIGGER company_closed_schedule_assignment_cancellations BEFORE INSERT ON schedule_assignment_cancellations
WHEN EXISTS(SELECT 1 FROM company_closed_periods c WHERE EXISTS(SELECT 1 FROM schedule_assignments a WHERE a.id=NEW.assignment_id AND a.employee_id=c.employee_id AND c.month>=substr(a.effective_from,1,7)))
BEGIN SELECT RAISE(ABORT,'company_period_closed'); END;
