-- CR JORNADA 0037 - CANDIDATA LOCAL, NAO APLICAR NO D1 REMOTO SEM HOMOLOGACAO.
-- Complementa 0032/0035: um INSERT OR REPLACE pode substituir work_days
-- iniciado com dados identicos e rowid diferente. Gatilhos AFTER INSERT
-- que comparam somente os campos visiveis nao detectam essa substituicao.
-- Bloqueia ANTES da escrita se qualquer identidade ja iniciada for reutilizada.
-- Nao altera registros, indices, colunas ou snapshots existentes.
-- IMPORTANTE: instalar junto da mudanca em employee-cpf-punch.ts no patch v64.
-- A API precisa deixar de TENTAR inserir dias ja existentes (NOT EXISTS),
-- pois gatilhos BEFORE INSERT disparam antes do ON CONFLICT DO NOTHING.
CREATE TRIGGER company_started_workday_no_implicit_replacement
BEFORE INSERT ON work_days
WHEN EXISTS (
  SELECT 1 FROM company_started_workday_snapshot_registry r
  WHERE r.work_day_id=NEW.id
     OR (r.employee_id=NEW.employee_id AND r.work_date=NEW.work_date)
)
BEGIN SELECT RAISE(ABORT,'company_started_workday_immutable'); END;
