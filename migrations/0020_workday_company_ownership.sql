-- CR JORNADA 0020: propriedade empresarial dos dias de ponto.
-- Apenas D1 LOCAL nesta etapa. Nao habilita criacao de marcacoes.
-- A coluna continua NULL para dias legados; nenhuma linha e migrada.

ALTER TABLE work_days
ADD COLUMN company_id TEXT REFERENCES companies(id);

CREATE INDEX work_days_company_date
ON work_days(company_id, work_date, employee_id);

CREATE UNIQUE INDEX work_days_id_company_reference
ON work_days(id, company_id);

-- Ao criar um dia com empresa definida, vinculo e empresa devem estar ativos.
-- Novas rotas multiempresa serao obrigadas a incluir company_id.
-- A falta de empresa continua permitida SOMENTE por compatibilidade de
-- historicos e testes legados, cujas rotas de escrita seguem bloqueadas.
CREATE TRIGGER work_days_company_insert_guard
BEFORE INSERT ON work_days
WHEN NEW.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employees e
    JOIN companies co ON co.id = e.company_id
    WHERE e.id = NEW.employee_id
      AND e.company_id = NEW.company_id
      AND co.status = 'active'
      AND e.status = 'active'
      AND e.deleted_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'work_day_company_mismatch'); END;

-- Nao permitir vinculacao (inclusive conciliacao de legado) a empresa
-- diferente daquela a que o funcionario pertence.
CREATE TRIGGER work_days_company_update_guard
BEFORE UPDATE OF company_id ON work_days
WHEN NEW.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employees e
    JOIN companies co ON co.id = e.company_id
    WHERE e.id = NEW.employee_id
      AND e.company_id = NEW.company_id
      AND co.status = 'active'
      AND e.status = 'active'
      AND e.deleted_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'work_day_company_mismatch'); END;

-- Nunca transferir um dia iniciado para outra empresa.
CREATE TRIGGER work_days_company_immutable
BEFORE UPDATE OF company_id ON work_days
WHEN OLD.company_id IS NOT NULL
  AND OLD.company_id IS NOT NEW.company_id
BEGIN SELECT RAISE(ABORT, 'work_day_company_immutable'); END;

-- Dias empresariais nao podem apontar para funcionario de outra empresa
-- mesmo que uma rota futura tente trocar o ID (sem editar o historico legado).
CREATE TRIGGER work_days_employee_company_guard
BEFORE UPDATE OF employee_id ON work_days
WHEN NEW.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employees e
    JOIN companies co ON co.id = e.company_id
    WHERE e.id = NEW.employee_id
      AND e.company_id = NEW.company_id
      AND co.status = 'active'
      AND e.status = 'active'
      AND e.deleted_at IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'work_day_company_mismatch'); END;

-- Defesa em profundidade: marcações novas em dias empresariais
-- devem referir-se ao mesmo empregado e a uma empresa ativa.
-- Os triggers originais de sequencia e imutabilidade permanecem vigentes.
CREATE TRIGGER punches_company_insert_guard
BEFORE INSERT ON punches
WHEN EXISTS (
  SELECT 1 FROM work_days d
  WHERE d.id = NEW.work_day_id AND d.company_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM work_days d
  JOIN employees e ON e.id = d.employee_id
    AND e.company_id = d.company_id
  JOIN companies co ON co.id = d.company_id
  WHERE d.id = NEW.work_day_id
    AND d.employee_id = NEW.employee_id
    AND co.status = 'active'
    AND e.status = 'active'
    AND e.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'punch_company_mismatch'); END;
