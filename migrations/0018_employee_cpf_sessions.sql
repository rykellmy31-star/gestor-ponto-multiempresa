-- CR JORNADA - 0018 - Sessoes e desafios de CPF empresarial
-- Preparacao aditiva. NAO libera as rotas antigas ou remove UNIQUE global.
-- Aplicacao somente em D1 local ate aprovacao explicita.

CREATE UNIQUE INDEX users_id_employee_reference
ON users(id, employee_id);

CREATE TABLE employee_company_sessions (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
  user_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  auth_version INTEGER NOT NULL,
  FOREIGN KEY (user_id, employee_id)
    REFERENCES users(id, employee_id),
  FOREIGN KEY (employee_id, company_id)
    REFERENCES employees(id, company_id)
);

CREATE INDEX employee_company_sessions_user
ON employee_company_sessions(user_id, expires_at);

CREATE INDEX employee_company_sessions_company
ON employee_company_sessions(company_id, expires_at);

CREATE TRIGGER employee_company_sessions_identity_immutable
BEFORE UPDATE OF token_hash,user_id,employee_id,company_id,auth_version
ON employee_company_sessions
BEGIN SELECT RAISE(ABORT, 'employee_session_identity_immutable'); END;

CREATE TABLE employee_login_challenges (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
  choices_json TEXT NOT NULL
    CHECK(json_valid(choices_json) AND json_type(choices_json) = 'array'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  consumed_nonce TEXT
);

CREATE INDEX employee_login_challenges_expires
ON employee_login_challenges(expires_at);

CREATE TRIGGER employee_login_challenge_identity_immutable
BEFORE UPDATE OF token_hash,choices_json,created_at,expires_at
ON employee_login_challenges
BEGIN SELECT RAISE(ABORT, 'employee_challenge_immutable'); END;
