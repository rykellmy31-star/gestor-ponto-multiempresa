-- Arquivamento seguro de funcionarios.
-- Nenhum registro de ponto, atribuicao ou historico e removido.
-- Aplicar primeiramente em pontopaguepouco_restore_test.
ALTER TABLE employees ADD COLUMN deleted_at INTEGER;
ALTER TABLE employees ADD COLUMN deleted_by TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS employees_not_deleted
ON employees(deleted_at, status);

-- Impede que um arquivamento seja desfeito acidentalmente alterando a data.
CREATE TRIGGER IF NOT EXISTS employee_deleted_at_immutable
BEFORE UPDATE OF deleted_at, deleted_by ON employees
WHEN OLD.deleted_at IS NOT NULL
 AND (
   NEW.deleted_at IS NOT OLD.deleted_at OR
   NEW.deleted_by IS NOT OLD.deleted_by
 )
BEGIN
  SELECT RAISE(ABORT, 'employee_archive_immutable');
END;
