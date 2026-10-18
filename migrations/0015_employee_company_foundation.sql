
-- CR JORNADA - Migracao 0015
-- Preparacao do isolamento dos funcionarios por empresa.
-- Nao habilita rotas de funcionarios ou registro de ponto.

-- Adiciona o identificador da empresa.
-- Inicialmente permite NULL para preservar dados legados.
ALTER TABLE employees
ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Melhora consultas por empresa.
CREATE INDEX employees_company
ON employees(company_id, status, deleted_at);

-- Impede vincular novos funcionarios sem empresa.
CREATE TRIGGER employees_require_company
BEFORE INSERT ON employees
WHEN NEW.company_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'employee_company_required');
END;

-- Impede transferir um funcionario entre empresas.
CREATE TRIGGER employees_company_immutable
BEFORE UPDATE OF company_id ON employees
WHEN OLD.company_id IS NOT NEW.company_id
BEGIN
  SELECT RAISE(ABORT, 'employee_company_immutable');
END;
