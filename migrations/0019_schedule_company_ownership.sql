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
