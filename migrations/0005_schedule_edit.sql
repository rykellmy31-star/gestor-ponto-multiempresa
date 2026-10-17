
-- 0005_schedule_edit.sql
-- Permite editar nome e horarios de uma jornada.
-- Preserva identificador e dados de criacao.

DROP TRIGGER IF EXISTS schedules_immutable;

CREATE TRIGGER schedules_immutable
BEFORE UPDATE ON schedules
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(
    ABORT,
    'schedule_version_immutable'
  );
END;

-- Salva automaticamente a configuracao inicial
-- quando uma nova jornada for cadastrada.

CREATE TRIGGER IF NOT EXISTS schedule_history_seed
AFTER INSERT ON schedules
BEGIN
  INSERT INTO schedule_history (
    schedule_id,
    effective_from,
    name,
    config_json,
    changed_by,
    created_at
  )
  VALUES (
    NEW.id,
    '1900-01-01',
    NEW.name,
    NEW.config_json,
    NEW.created_by,
    NEW.created_at
  );
END;
