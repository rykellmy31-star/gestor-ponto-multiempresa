-- CR JORNADA 0019 — Vinculo empresarial aditivo para jornadas.
-- Compativel com horarios historicos legados que ainda nao possuem proprietario.
-- O backend novo deve exigir s.company_id = sessao.company_id para USAR
-- qualquer jornada. O cadastro legado permanece bloqueado no roteador.
-- Migracao remota NAO autorizada.

ALTER TABLE schedules ADD COLUMN company_id TEXT REFERENCES companies(id);
CREATE INDEX schedules_company_owner ON schedules(company_id, id);

-- Uma jornada com proprietario precisa pertencer a empresa ativa.
-- Nao rejeitar insercoes sem proprietario aqui: os testes de compatibilidade
-- e os fluxos legados ainda possuem registros historicos sem company_id.
CREATE TRIGGER schedules_company_owner_valid
BEFORE INSERT ON schedules
WHEN NEW.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = NEW.company_id AND c.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'schedule_active_company_required');
END;

CREATE TRIGGER schedules_company_owner_immutable
BEFORE UPDATE OF company_id ON schedules
WHEN OLD.company_id IS NOT NULL
  AND OLD.company_id IS NOT NEW.company_id
BEGIN SELECT RAISE(ABORT, 'schedule_company_immutable'); END;

-- Um horario empresarial nunca pode ser atribuido a um funcionario
-- de outra empresa. O legado sem proprietario nao e migrado aqui.
CREATE TRIGGER schedule_assignments_company_match
BEFORE INSERT ON schedule_assignments
WHEN EXISTS (
  SELECT 1 FROM schedules s
  WHERE s.id = NEW.schedule_id AND s.company_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM employees e
  JOIN schedules s ON s.id = NEW.schedule_id
  JOIN companies c ON c.id = e.company_id
  WHERE e.id = NEW.employee_id
    AND e.company_id = s.company_id
    AND e.status = 'active'
    AND e.deleted_at IS NULL
    AND c.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'schedule_company_mismatch'); END;

-- Mesma garantia para historico novo das jornadas com proprietario,
-- sem interromper o historico anterior a migracao.
CREATE TRIGGER schedule_history_company_valid
BEFORE INSERT ON schedule_history
WHEN EXISTS (
  SELECT 1 FROM schedules s WHERE s.id = NEW.schedule_id
    AND s.company_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM schedules s
  JOIN companies c ON c.id = s.company_id AND c.status = 'active'
  WHERE s.id = NEW.schedule_id
)
BEGIN SELECT RAISE(ABORT, 'schedule_history_company_required'); END;

-- Eventos empresariais imutaveis do cadastro de jornadas.
-- A FK composta impede auditoria de um administrador de outra empresa.
CREATE UNIQUE INDEX company_admin_id_company_reference
ON company_admins(id, company_id);

CREATE TABLE company_schedule_audit (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created','assigned')),
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  employee_id TEXT REFERENCES employees(id),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (admin_id, company_id)
    REFERENCES company_admins(id, company_id)
);

CREATE INDEX company_schedule_audit_company
ON company_schedule_audit(company_id, created_at DESC);

CREATE TRIGGER company_schedule_audit_immutable_update
BEFORE UPDATE ON company_schedule_audit
BEGIN SELECT RAISE(ABORT, 'schedule_audit_immutable'); END;
CREATE TRIGGER company_schedule_audit_immutable_delete
BEFORE DELETE ON company_schedule_audit
BEGIN SELECT RAISE(ABORT, 'schedule_audit_immutable'); END;
