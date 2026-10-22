-- CR JORNADA 0035 — CANDIDATA LOCAL: nao executar em D1 remoto.
-- Deve seguir as migracoes originais 0001–0027 e candidatas 0028–0034.
-- Corrige uma substituicao implicita que contorna o BEFORE DELETE do
-- registro imutavel criado na candidata 0032 quando recursive_triggers=OFF.
-- Mesmo um INSERT OR REPLACE com todos os campos identicos apaga o rowid
-- antigo e o recria; nao e uma operacao append-only.
-- Protege ambas as chaves UNIQUE: work_day_id e (employee_id, work_date).
-- Nenhuma linha existente e modificada e nenhuma tabela e reconstruida.
-- Um registro novo, originado pelo primeiro ponto ou conciliacao legitima,
-- continua permitido. Conflitos DO NOTHING tambem sao recusados no registro
-- imutavel: nao sao uma operacao esperada neste fluxo.
CREATE TRIGGER company_started_snapshot_registry_no_implicit_replacement
BEFORE INSERT ON company_started_workday_snapshot_registry
WHEN EXISTS (
  SELECT 1 FROM company_started_workday_snapshot_registry r
  WHERE r.work_day_id = NEW.work_day_id
     OR (r.employee_id = NEW.employee_id AND r.work_date = NEW.work_date)
)
BEGIN
  SELECT RAISE(ABORT, 'company_started_snapshot_registry_immutable');
END;
