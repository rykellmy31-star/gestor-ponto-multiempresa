PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  company_name TEXT NOT NULL,
  company_document TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL CHECK(timezone IN ('America/Bahia','America/Sao_Paulo')),
  updated_at INTEGER NOT NULL
);
INSERT INTO settings VALUES (1, 'Minha empresa', '', 'America/Bahia', unixepoch() * 1000);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  registration TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cpf_encrypted TEXT,
  cpf_last4 TEXT,
  job_title TEXT NOT NULL DEFAULT '',
  admission_date TEXT NOT NULL CHECK(length(admission_date) = 10),
  employment_end TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','blocked','terminated')) DEFAULT 'active',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','employee')),
  employee_id TEXT UNIQUE REFERENCES employees(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((role = 'admin' AND employee_id IS NULL) OR (role = 'employee' AND employee_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
CREATE TRIGGER users_role_immutable BEFORE UPDATE OF role, employee_id ON users
BEGIN SELECT RAISE(ABORT, 'role_immutable'); END;
CREATE TRIGGER last_admin BEFORE UPDATE OF active ON users
WHEN OLD.role = 'admin' AND OLD.active = 1 AND NEW.active = 0 AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin'); END;
CREATE TRIGGER users_no_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'users_no_delete'); END;

CREATE TABLE setup_state (id INTEGER PRIMARY KEY CHECK(id = 1), completed_at INTEGER NOT NULL);
CREATE TRIGGER setup_once BEFORE INSERT ON setup_state
WHEN EXISTS(SELECT 1 FROM users WHERE role = 'admin')
BEGIN SELECT RAISE(ABORT, 'setup_completed'); END;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  realm TEXT NOT NULL CHECK(realm IN ('admin','employee')),
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  reauth_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX reset_user ON password_reset_tokens(user_id);
CREATE TABLE recovery_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('pending','resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE UNIQUE INDEX recovery_pending ON recovery_requests(user_id) WHERE status = 'pending';

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER schedules_immutable BEFORE UPDATE ON schedules BEGIN SELECT RAISE(ABORT, 'schedule_version_immutable'); END;
CREATE TRIGGER schedules_no_delete BEFORE DELETE ON schedules BEGIN SELECT RAISE(ABORT, 'schedule_version_immutable'); END;
CREATE TABLE schedule_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  effective_from TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(employee_id, effective_from)
);
CREATE INDEX assignments_dates ON schedule_assignments(employee_id, effective_from DESC);
CREATE TRIGGER assignments_immutable BEFORE UPDATE ON schedule_assignments BEGIN SELECT RAISE(ABORT, 'assignment_immutable'); END;
CREATE TRIGGER assignments_no_delete BEFORE DELETE ON schedule_assignments BEGIN SELECT RAISE(ABORT, 'assignment_immutable'); END;
CREATE TABLE rule_versions (
  id TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
INSERT INTO rule_versions VALUES ('initial-rules','1900-01-01','{"mark_tolerance":5,"daily_tolerance":10,"rounding_step":1,"rounding_mode":"floor","auto_approve_overtime":false,"compensation":"review","max_shift_hours":24}',NULL,unixepoch()*1000);
CREATE TRIGGER rules_immutable BEFORE UPDATE ON rule_versions BEGIN SELECT RAISE(ABORT, 'rule_version_immutable'); END;
CREATE TRIGGER rules_no_delete BEFORE DELETE ON rule_versions BEGIN SELECT RAISE(ABORT, 'rule_version_immutable'); END;
CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE work_days (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  schedule_json TEXT NOT NULL CHECK(json_valid(schedule_json)),
  rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
  next_seq INTEGER NOT NULL DEFAULT 0 CHECK(next_seq BETWEEN 0 AND 4),
  created_at INTEGER NOT NULL,
  last_at INTEGER,
  UNIQUE(employee_id, work_date)
);
CREATE INDEX work_days_date ON work_days(work_date, employee_id);
CREATE TABLE punches (
  id TEXT PRIMARY KEY,
  work_day_id TEXT NOT NULL REFERENCES work_days(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  seq INTEGER NOT NULL CHECK(seq BETWEEN 0 AND 3),
  type TEXT NOT NULL CHECK(type IN ('entry','break_start','break_end','exit')),
  recorded_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  UNIQUE(work_day_id, seq),
  UNIQUE(employee_id, idempotency_key)
);
CREATE INDEX punches_employee_time ON punches(employee_id, recorded_at);
CREATE TRIGGER punches_immutable_update BEFORE UPDATE ON punches BEGIN SELECT RAISE(ABORT, 'raw_punch_immutable'); END;
CREATE TRIGGER punches_immutable_delete BEFORE DELETE ON punches BEGIN SELECT RAISE(ABORT, 'raw_punch_immutable'); END;
CREATE TRIGGER punch_sequence BEFORE INSERT ON punches BEGIN
  SELECT CASE WHEN NEW.employee_id != (SELECT employee_id FROM work_days WHERE id = NEW.work_day_id) THEN RAISE(ABORT, 'employee_mismatch') END;
  SELECT CASE WHEN NEW.seq != (SELECT next_seq FROM work_days WHERE id = NEW.work_day_id) THEN RAISE(ABORT, 'invalid_sequence') END;
  SELECT CASE WHEN NEW.type != CASE NEW.seq WHEN 0 THEN 'entry' WHEN 1 THEN 'break_start' WHEN 2 THEN 'break_end' ELSE 'exit' END THEN RAISE(ABORT, 'invalid_sequence') END;
  SELECT CASE WHEN NEW.recorded_at < COALESCE((SELECT last_at FROM work_days WHERE id = NEW.work_day_id),0) THEN RAISE(ABORT, 'non_monotonic_time') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM adjustments WHERE work_day_id = NEW.work_day_id) THEN RAISE(ABORT, 'day_adjusted') END;
END;
CREATE TRIGGER punch_advance AFTER INSERT ON punches BEGIN
  UPDATE work_days SET next_seq = NEW.seq + 1, last_at = NEW.recorded_at WHERE id = NEW.work_day_id;
END;
CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  work_day_id TEXT NOT NULL REFERENCES work_days(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  reason TEXT NOT NULL CHECK(length(reason) >= 10),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX adjustments_days ON adjustments(work_day_id, created_at DESC);
CREATE TRIGGER adjustments_no_update BEFORE UPDATE ON adjustments BEGIN SELECT RAISE(ABORT, 'adjustment_immutable'); END;
CREATE TRIGGER adjustments_no_delete BEFORE DELETE ON adjustments BEGIN SELECT RAISE(ABORT, 'adjustment_immutable'); END;

CREATE TABLE occurrences (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('justified_absence','medical','day_off','unjustified_absence','note')),
  reason TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  review_reason TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX occurrences_dates ON occurrences(employee_id, work_date);
CREATE TABLE overtime_decisions (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  approved_minutes INTEGER NOT NULL CHECK(approved_minutes >= 0),
  status TEXT NOT NULL CHECK(status IN ('approved','rejected')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX overtime_dates ON overtime_decisions(employee_id, work_date, created_at DESC);
CREATE TRIGGER overtime_no_update BEFORE UPDATE ON overtime_decisions BEGIN SELECT RAISE(ABORT, 'overtime_immutable'); END;
CREATE TRIGGER overtime_no_delete BEFORE DELETE ON overtime_decisions BEGIN SELECT RAISE(ABORT, 'overtime_immutable'); END;

CREATE TABLE monthly_closures (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('closed','open')),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  report_hash TEXT NOT NULL,
  closed_by TEXT NOT NULL REFERENCES users(id),
  closed_at INTEGER NOT NULL,
  reopened_at INTEGER,
  reopen_reason TEXT,
  UNIQUE(employee_id, month)
);
CREATE TABLE closure_snapshots (
  id TEXT PRIMARY KEY,
  closure_id TEXT NOT NULL REFERENCES monthly_closures(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  report_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE(closure_id, version)
);
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON closure_snapshots BEGIN SELECT RAISE(ABORT, 'snapshot_immutable'); END;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON closure_snapshots BEGIN SELECT RAISE(ABORT, 'snapshot_immutable'); END;
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_created ON audit_log(created_at DESC);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;

CREATE TABLE data_revision (id INTEGER PRIMARY KEY CHECK(id = 1), value INTEGER NOT NULL);
INSERT INTO data_revision VALUES(1,0);
CREATE TABLE write_guards (id TEXT PRIMARY KEY, expected_revision INTEGER NOT NULL);
CREATE TRIGGER revision_guard BEFORE INSERT ON write_guards
WHEN NEW.expected_revision != (SELECT value FROM data_revision WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'concurrent_modification'); END;

CREATE TRIGGER workday_closed_insert BEFORE INSERT ON work_days
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE employee_id = NEW.employee_id AND month = substr(NEW.work_date,1,7) AND status = 'closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER workday_closed_update BEFORE UPDATE ON work_days
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE employee_id = OLD.employee_id AND month = substr(OLD.work_date,1,7) AND status = 'closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER punch_closed BEFORE INSERT ON punches
WHEN EXISTS(SELECT 1 FROM monthly_closures c JOIN work_days d ON d.employee_id=c.employee_id AND substr(d.work_date,1,7)=c.month WHERE d.id=NEW.work_day_id AND c.status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER adjustment_closed BEFORE INSERT ON adjustments
WHEN EXISTS(SELECT 1 FROM monthly_closures c JOIN work_days d ON d.employee_id=c.employee_id AND substr(d.work_date,1,7)=c.month WHERE d.id=NEW.work_day_id AND c.status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER occurrence_closed_insert BEFORE INSERT ON occurrences
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE employee_id=NEW.employee_id AND month=substr(NEW.work_date,1,7) AND status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER occurrence_closed_update BEFORE UPDATE ON occurrences
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE employee_id=OLD.employee_id AND month=substr(OLD.work_date,1,7) AND status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER overtime_closed BEFORE INSERT ON overtime_decisions
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE employee_id=NEW.employee_id AND month=substr(NEW.work_date,1,7) AND status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER holiday_closed_insert BEFORE INSERT ON holidays
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE month=substr(NEW.date,1,7) AND status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed_reopen_all'); END;
CREATE TRIGGER holiday_closed_delete BEFORE DELETE ON holidays
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE month=substr(OLD.date,1,7) AND status='closed')
BEGIN SELECT RAISE(ABORT, 'period_closed_reopen_all'); END;
CREATE TRIGGER assignment_closed BEFORE INSERT ON schedule_assignments
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE employee_id=NEW.employee_id AND status='closed' AND month >= substr(NEW.effective_from,1,7))
BEGIN SELECT RAISE(ABORT, 'period_closed'); END;
CREATE TRIGGER rule_closed BEFORE INSERT ON rule_versions
WHEN EXISTS(SELECT 1 FROM monthly_closures WHERE status='closed' AND month >= substr(NEW.effective_from,1,7))
BEGIN SELECT RAISE(ABORT, 'period_closed_reopen_all'); END;
CREATE TRIGGER revision_employees_insert AFTER INSERT ON employees BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_employees_update AFTER UPDATE ON employees BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_settings_update AFTER UPDATE ON settings BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_schedules_insert AFTER INSERT ON schedules BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_schedule_assignments_insert AFTER INSERT ON schedule_assignments BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_rule_versions_insert AFTER INSERT ON rule_versions BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_holidays_insert AFTER INSERT ON holidays BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_holidays_delete AFTER DELETE ON holidays BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_work_days_insert AFTER INSERT ON work_days BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_work_days_update AFTER UPDATE ON work_days BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_punches_insert AFTER INSERT ON punches BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_adjustments_insert AFTER INSERT ON adjustments BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_occurrences_insert AFTER INSERT ON occurrences BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_occurrences_update AFTER UPDATE ON occurrences BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_overtime_decisions_insert AFTER INSERT ON overtime_decisions BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
ALTER TABLE password_reset_tokens ADD COLUMN consumed_nonce TEXT;
CREATE TABLE login_identifiers (identifier TEXT PRIMARY KEY COLLATE NOCASE, user_id TEXT NOT NULL REFERENCES users(id));
CREATE INDEX identifiers_user ON login_identifiers(user_id);
CREATE TRIGGER identifiers_user_insert AFTER INSERT ON users BEGIN
  INSERT INTO login_identifiers VALUES(NEW.login,NEW.id);
  INSERT INTO login_identifiers SELECT NEW.email,NEW.id WHERE NEW.email IS NOT NULL AND lower(NEW.email)!=lower(NEW.login);
  INSERT INTO login_identifiers SELECT registration,NEW.id FROM employees WHERE id=NEW.employee_id AND lower(registration)!=lower(NEW.login) AND (NEW.email IS NULL OR lower(registration)!=lower(NEW.email));
END;
CREATE TRIGGER identifiers_user_update AFTER UPDATE OF login,email ON users BEGIN
  DELETE FROM login_identifiers WHERE user_id=NEW.id;
  INSERT INTO login_identifiers VALUES(NEW.login,NEW.id);
  INSERT INTO login_identifiers SELECT NEW.email,NEW.id WHERE NEW.email IS NOT NULL AND lower(NEW.email)!=lower(NEW.login);
  INSERT INTO login_identifiers SELECT registration,NEW.id FROM employees WHERE id=NEW.employee_id AND lower(registration)!=lower(NEW.login) AND (NEW.email IS NULL OR lower(registration)!=lower(NEW.email));
END;
CREATE TRIGGER identifiers_registration AFTER UPDATE OF registration ON employees BEGIN
  DELETE FROM login_identifiers WHERE user_id IN(SELECT id FROM users WHERE employee_id=NEW.id);
  INSERT INTO login_identifiers SELECT login,id FROM users WHERE employee_id=NEW.id;
  INSERT INTO login_identifiers SELECT email,id FROM users WHERE employee_id=NEW.id AND email IS NOT NULL AND lower(email)!=lower(login);
  INSERT INTO login_identifiers SELECT NEW.registration,id FROM users WHERE employee_id=NEW.id AND lower(NEW.registration)!=lower(login) AND (email IS NULL OR lower(NEW.registration)!=lower(email));
END;
ALTER TABLE overtime_decisions ADD COLUMN basis_hash TEXT NOT NULL DEFAULT '';
CREATE TRIGGER revision_closure_insert AFTER INSERT ON monthly_closures BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
CREATE TRIGGER revision_closure_update AFTER UPDATE ON monthly_closures BEGIN UPDATE data_revision SET value=value+1 WHERE id=1; END;
