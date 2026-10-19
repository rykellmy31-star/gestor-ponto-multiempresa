-- CR JORNADA — 0019 — Propriedade empresarial das jornadas.
-- MIGRACAO ADITIVA: nao move, apaga nem reescreve jornadas existentes.
-- Jornadas legadas ficam com company_id NULL ate conciliacao administrativa.
-- Somente ambiente D1 local nesta etapa.

ALTER TABLE schedules
ADD COLUMN company_id TEXT REFERENCES companies(id);

CREATE INDEX schedules_company_owner
ON schedules(company_id, id);

-- Nao aceitar novas jornadas sem proprietario ou em empresa desativada.
CREATE TRIGGER schedules_company_insert_required
BEFORE INSERT ON schedules
WHEN NEW.company_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = NEW.company_id AND c.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'schedule_active_company_required');
END;

-- Proibe transferencias silenciosas entre empresas.
-- Permite apenas conciliacao de linhas legadas (NULL -> empresa) que sera
-- controlada por rotina administrativa validada em etapa posterior.
CREATE TRIGGER schedules_company_owner_immutable
BEFORE UPDATE OF company_id ON schedules
WHEN OLD.company_id IS NOT NULL
  AND OLD.company_id IS NOT NEW.company_id
BEGIN
  SELECT RAISE(ABORT, 'schedule_company_immutable');
END;

-- Protege a atribuicao, inclusive se uma futura rota de API
-- esquecer de filtrar company_id. Nao altera atribuicoes antigas.
CREATE TRIGGER schedule_assignments_company_match
BEFORE INSERT ON schedule_assignments
WHEN NOT EXISTS (
  SELECT 1
  FROM employees e
  JOIN schedules s ON s.id = NEW.schedule_id
  JOIN companies c ON c.id = e.company_id
  WHERE e.id = NEW.employee_id
    AND e.company_id = s.company_id
    AND s.company_id IS NOT NULL
    AND e.status = 'active'
    AND e.deleted_at IS NULL
    AND c.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'schedule_company_mismatch');
END;

-- Uma jornada nova so recebe versoes dentro do seu vinculo empresarial.
CREATE TRIGGER schedule_history_company_required
BEFORE INSERT ON schedule_history
WHEN NOT EXISTS (
  SELECT 1
  FROM schedules s
  JOIN companies c ON c.id = s.company_id
  WHERE s.id = NEW.schedule_id
    AND c.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'schedule_history_company_required');
END;
