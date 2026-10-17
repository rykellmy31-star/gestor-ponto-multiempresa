
DROP TRIGGER IF EXISTS schedules_no_delete;

CREATE TRIGGER schedules_no_delete
BEFORE DELETE ON schedules
WHEN EXISTS (
  SELECT 1 FROM schedule_assignments
  WHERE schedule_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'schedule_version_immutable');
END;
  
