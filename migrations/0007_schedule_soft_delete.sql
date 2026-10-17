
-- MIGRACAO 0007
-- Exclusao logica de jornadas, preservando o historico.

ALTER TABLE schedules
ADD COLUMN deleted_at INTEGER DEFAULT NULL;

-- Protege jornadas que ja foram atribuidas
-- e impede restaurar jornadas excluidas logicamente.
CREATE TRIGGER IF NOT EXISTS schedules_soft_delete_guard
BEFORE UPDATE OF deleted_at ON schedules
WHEN (
  OLD.deleted_at IS NOT NULL
  AND NEW.deleted_at IS NOT OLD.deleted_at
)
OR (
  OLD.deleted_at IS NULL
  AND NEW.deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM schedule_assignments
    WHERE schedule_id = OLD.id
  )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'schedule_soft_delete_not_allowed'
  );
END;

-- Impede atribuir funcionarios a jornadas excluidas.
CREATE TRIGGER IF NOT EXISTS assignments_prevent_deleted_schedule
BEFORE INSERT ON schedule_assignments
WHEN EXISTS (
  SELECT 1
  FROM schedules
  WHERE id = NEW.schedule_id
    AND deleted_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'schedule_deleted');
END;
