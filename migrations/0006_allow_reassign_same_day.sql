
-- MIGRACAO 0006
-- Permite nova atribuicao na mesma data quando a anterior
-- estiver cancelada, preservando o historico.

PRAGMA defer_foreign_keys = ON;

-- Copias temporarias dos registros existentes.
CREATE TABLE backup_assignments_0006 AS
SELECT id, employee_id, schedule_id, effective_from, created_at
FROM schedule_assignments;

CREATE TABLE backup_cancellations_0006 AS
SELECT assignment_id, cancelled_at, cancelled_by, reason
FROM schedule_assignment_cancellations;

-- Reconstrucao sem a restricao UNIQUE antiga.
DROP TABLE schedule_assignment_cancellations;
DROP TABLE schedule_assignments;

CREATE TABLE schedule_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  effective_from TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO schedule_assignments (
  id, employee_id, schedule_id, effective_from, created_at
)
SELECT
  id, employee_id, schedule_id, effective_from, created_at
FROM backup_assignments_0006;

CREATE INDEX assignments_dates
ON schedule_assignments(employee_id, effective_from DESC);

-- Restaura a tabela de cancelamentos e seus registros.
CREATE TABLE schedule_assignment_cancellations (
  assignment_id TEXT PRIMARY KEY
    REFERENCES schedule_assignments(id),
  cancelled_at INTEGER NOT NULL,
  cancelled_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT 'Cancelamento administrativo'
);

INSERT INTO schedule_assignment_cancellations (
  assignment_id, cancelled_at, cancelled_by, reason
)
SELECT
  assignment_id, cancelled_at, cancelled_by, reason
FROM backup_cancellations_0006;

DROP TABLE backup_assignments_0006;
DROP TABLE backup_cancellations_0006;

-- Preserva a protecao dos periodos fechados.
CREATE TRIGGER assignment_closed
BEFORE INSERT ON schedule_assignments
WHEN EXISTS (
  SELECT 1 FROM monthly_closures
  WHERE employee_id = NEW.employee_id
    AND status = 'closed'
    AND month >= substr(NEW.effective_from, 1, 7)
)
BEGIN
  SELECT RAISE(ABORT, 'period_closed');
END;

-- Atribuicoes antigas nao podem ser alteradas ou excluidas.
CREATE TRIGGER assignments_immutable
BEFORE UPDATE ON schedule_assignments
BEGIN
  SELECT RAISE(ABORT, 'assignment_immutable');
END;

CREATE TRIGGER assignments_no_delete
BEFORE DELETE ON schedule_assignments
BEGIN
  SELECT RAISE(ABORT, 'assignment_immutable');
END;

-- Atualiza a revisao dos dados.
CREATE TRIGGER revision_schedule_assignments_insert
AFTER INSERT ON schedule_assignments
BEGIN
  UPDATE data_revision
  SET value = value + 1
  WHERE id = 1;
END;

CREATE TRIGGER revision_schedule_assignment_cancellations_insert
AFTER INSERT ON schedule_assignment_cancellations
BEGIN
  UPDATE data_revision
  SET value = value + 1
  WHERE id = 1;
END;

-- Impede duas atribuicoes ATIVAS na mesma data,
-- mas permite substituir uma atribuicao cancelada.
CREATE TRIGGER assignments_only_one_active_date
BEFORE INSERT ON schedule_assignments
WHEN EXISTS (
  SELECT 1
  FROM schedule_assignments a
  WHERE a.employee_id = NEW.employee_id
    AND a.effective_from = NEW.effective_from
    AND NOT EXISTS (
      SELECT 1
      FROM schedule_assignment_cancellations cac
      WHERE cac.assignment_id = a.id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'schedule_date_conflict');
END;

-- Protege os registros de cancelamento.
CREATE TRIGGER schedule_assignment_cancellations_no_update
BEFORE UPDATE ON schedule_assignment_cancellations
BEGIN
  SELECT RAISE(ABORT, 'cancellation_immutable');
END;

CREATE TRIGGER schedule_assignment_cancellations_no_delete
BEFORE DELETE ON schedule_assignment_cancellations
BEGIN
  SELECT RAISE(ABORT, 'cancellation_immutable');
END;
