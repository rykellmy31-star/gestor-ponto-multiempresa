-- CR JORNADA 0038 - CANDIDATA LOCAL. NAO EXECUTAR EM D1 REMOTO.
-- Chave por empresa + gestor para tornar POST /company/schedules repetivel.
-- Instalar com a rota e a interface do pacote v67, apos 0001-0037.
CREATE TABLE company_schedule_create_requests (
  company_id TEXT NOT NULL REFERENCES companies(id),
  admin_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, admin_id, request_key)
);
CREATE UNIQUE INDEX company_schedule_request_unique_schedule
  ON company_schedule_create_requests(schedule_id);
CREATE TRIGGER company_schedule_request_no_update
BEFORE UPDATE ON company_schedule_create_requests
BEGIN SELECT RAISE(ABORT,'company_schedule_request_immutable'); END;
CREATE TRIGGER company_schedule_request_no_delete
BEFORE DELETE ON company_schedule_create_requests
BEGIN SELECT RAISE(ABORT,'company_schedule_request_immutable'); END;
CREATE TRIGGER company_schedule_request_no_replace
BEFORE INSERT ON company_schedule_create_requests
WHEN EXISTS (SELECT 1 FROM company_schedule_create_requests r
            WHERE r.company_id=NEW.company_id AND r.admin_id=NEW.admin_id
              AND r.request_key=NEW.request_key)
BEGIN SELECT RAISE(ABORT,'company_schedule_request_immutable'); END;
