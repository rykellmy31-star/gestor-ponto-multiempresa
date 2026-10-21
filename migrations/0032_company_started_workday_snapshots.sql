-- CR JORNADA 0032 — proteção aditiva do histórico de dias empresariais.
-- CANDIDATA LOCAL: não executar em D1 remoto antes da homologação.
-- Preserva os registros existentes. Não reconstrói nenhuma tabela.
-- Um work_day empresarial é considerado iniciado quando next_seq entre 1 e 4.
-- Registro em tabela permanente protege inclusive contra INSERT OR REPLACE,
-- cujas exclusões implícitas podem ignorar gatilhos BEFORE DELETE no SQLite.

-- Raw punch history is immutable in migration 0001, but INSERT OR REPLACE
-- can delete another punch implicitly when recursive_triggers is OFF.
-- The original BEFORE DELETE trigger does not fire for such deletions.
-- Reject collisions with all three UNIQUE constraints BEFORE replacement.
-- Otherwise replacing a punch of company A while inserting company B's next
-- punch could silently invalidate A's history without updating work_days A.
-- A conflicting INSERT ... DO NOTHING is intentionally rejected: no caller
-- should attempt to insert a punch with an existing identity/sequence/nonce.
-- Migration-time validation: do not leave pre-existing enterprise days with
-- raw punches and next_seq=0 outside the immutable snapshot registry.
-- Cloudflare D1 executes migrations transactionally; the CHECK failure must
-- roll back this migration and preserve historical data for reconciliation.
-- No identifying employee or punch data is copied into the probe.
CREATE TABLE _company_started_workday_probe_0032 (
  orphan_count INTEGER NOT NULL
    CONSTRAINT company_unstarted_punch_history CHECK(orphan_count=0)
);
INSERT INTO _company_started_workday_probe_0032(orphan_count)
SELECT COUNT(*) FROM work_days d
WHERE d.company_id IS NOT NULL AND d.next_seq=0
  AND EXISTS (SELECT 1 FROM punches p WHERE p.work_day_id=d.id);
DROP TABLE _company_started_workday_probe_0032;

CREATE TRIGGER punches_no_implicit_replacement
BEFORE INSERT ON punches
WHEN EXISTS (
  SELECT 1 FROM punches existing
  WHERE existing.id=NEW.id
     OR (existing.work_day_id=NEW.work_day_id AND existing.seq=NEW.seq)
     OR (existing.employee_id=NEW.employee_id
         AND existing.idempotency_key=NEW.idempotency_key)
)
BEGIN SELECT RAISE(ABORT,'raw_punch_immutable'); END;

CREATE TABLE company_started_workday_snapshot_registry (
  work_day_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  schedule_json TEXT NOT NULL CHECK(json_valid(schedule_json)),
  rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(employee_id, work_date)
);

CREATE TRIGGER company_started_snapshot_registry_no_update
BEFORE UPDATE ON company_started_workday_snapshot_registry
BEGIN SELECT RAISE(ABORT,'company_started_snapshot_registry_immutable'); END;

CREATE TRIGGER company_started_snapshot_registry_no_delete
BEFORE DELETE ON company_started_workday_snapshot_registry
BEGIN SELECT RAISE(ABORT,'company_started_snapshot_registry_immutable'); END;

CREATE TRIGGER company_started_snapshot_registry_insert_guard
BEFORE INSERT ON company_started_workday_snapshot_registry
WHEN NOT EXISTS (
  SELECT 1 FROM work_days d
  WHERE d.id=NEW.work_day_id AND d.company_id=NEW.company_id
    AND d.employee_id=NEW.employee_id AND d.work_date=NEW.work_date
    AND d.timezone=NEW.timezone AND d.schedule_json=NEW.schedule_json
    AND d.rules_json=NEW.rules_json AND d.created_at=NEW.created_at
    AND d.next_seq BETWEEN 1 AND 4
    -- Validar o histórico ANTES da primeira carga. Sem essa cláusula a
    -- migração 0032 protegeria um estado que já está inconsistente.
    AND d.next_seq = (SELECT COUNT(*) FROM punches p WHERE p.work_day_id=d.id)
    AND d.last_at IS (SELECT MAX(p.recorded_at) FROM punches p WHERE p.work_day_id=d.id)
    AND (SELECT SUM(p.seq) FROM punches p WHERE p.work_day_id=d.id) =
        d.next_seq * (d.next_seq - 1) / 2
    -- COUNT + SUM + MAX alone cannot prove chronological punch order.
    AND NOT EXISTS (
      SELECT 1 FROM punches p
      JOIN punches previous ON previous.work_day_id=p.work_day_id
        AND previous.seq=p.seq-1
      WHERE p.work_day_id=d.id
        AND p.recorded_at<previous.recorded_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM punches p WHERE p.work_day_id=d.id
        AND (p.employee_id IS NOT d.employee_id OR
             p.type IS NOT CASE p.seq
               WHEN 0 THEN 'entry' WHEN 1 THEN 'break_start'
               WHEN 2 THEN 'break_end' ELSE 'exit' END)
    )
)
BEGIN SELECT RAISE(ABORT,'company_started_snapshot_registry_mismatch'); END;

-- Povoar somente dias de empresa já iniciados. O histórico legado (NULL) não muda.
INSERT INTO company_started_workday_snapshot_registry (
  work_day_id,company_id,employee_id,work_date,timezone,
  schedule_json,rules_json,created_at
)
SELECT id,company_id,employee_id,work_date,timezone,
       schedule_json,rules_json,created_at
FROM work_days
WHERE company_id IS NOT NULL AND next_seq BETWEEN 1 AND 4;

-- A sequência/horário final do ponto continua avançando via punch_advance;
-- os campos de identidade e histórico jamais mudam após a primeira batida.
CREATE TRIGGER company_started_workday_immutable_update
BEFORE UPDATE OF id,employee_id,work_date,timezone,schedule_json,rules_json,created_at
ON work_days
WHEN OLD.company_id IS NOT NULL AND OLD.next_seq BETWEEN 1 AND 4
 AND (
  NEW.id IS NOT OLD.id OR NEW.employee_id IS NOT OLD.employee_id OR
  NEW.work_date IS NOT OLD.work_date OR NEW.timezone IS NOT OLD.timezone OR
  NEW.schedule_json IS NOT OLD.schedule_json OR
  NEW.rules_json IS NOT OLD.rules_json OR NEW.created_at IS NOT OLD.created_at
 )
BEGIN SELECT RAISE(ABORT,'company_started_workday_immutable'); END;

CREATE TRIGGER company_started_workday_immutable_delete
BEFORE DELETE ON work_days
WHEN OLD.company_id IS NOT NULL AND OLD.next_seq BETWEEN 1 AND 4
BEGIN SELECT RAISE(ABORT,'company_started_workday_immutable'); END;

-- UPDATE OR REPLACE também pode excluir implicitamente outra linha por choque
-- na chave UNIQUE(employee_id, work_date). Proteger a colisão antes dela.
CREATE TRIGGER company_started_workday_update_replace_guard
BEFORE UPDATE OF id,employee_id,work_date ON work_days
WHEN EXISTS (
  SELECT 1 FROM company_started_workday_snapshot_registry r
  WHERE r.work_day_id IS NOT OLD.id
    AND (r.work_day_id=NEW.id OR
         (r.employee_id=NEW.employee_id AND r.work_date=NEW.work_date))
)
BEGIN SELECT RAISE(ABORT,'company_started_workday_immutable'); END;

-- Primeiro ponto: registrar o snapshot dentro do mesmo UPDATE do gatilho
-- punch_advance. Operações forjadas com next_seq/last_at inconsistentes falham.
CREATE TRIGGER company_started_workday_progress_guard
AFTER UPDATE OF next_seq,last_at ON work_days
WHEN NEW.company_id IS NOT NULL
BEGIN
  INSERT INTO company_started_workday_snapshot_registry (
    work_day_id,company_id,employee_id,work_date,timezone,
    schedule_json,rules_json,created_at
  )
  SELECT NEW.id,NEW.company_id,NEW.employee_id,NEW.work_date,NEW.timezone,
         NEW.schedule_json,NEW.rules_json,NEW.created_at
  WHERE OLD.next_seq=0 AND NEW.next_seq=1;

  SELECT CASE WHEN (
    NEW.next_seq=0 AND EXISTS (
      SELECT 1 FROM company_started_workday_snapshot_registry r
      WHERE r.work_day_id=NEW.id
    )
  ) OR (NEW.next_seq BETWEEN 1 AND 4 AND (
    NOT EXISTS (
      SELECT 1 FROM company_started_workday_snapshot_registry r
      WHERE r.work_day_id=NEW.id AND r.company_id=NEW.company_id
        AND r.employee_id=NEW.employee_id AND r.work_date=NEW.work_date
        AND r.timezone=NEW.timezone AND r.schedule_json=NEW.schedule_json
        AND r.rules_json=NEW.rules_json AND r.created_at=NEW.created_at
    )
    OR NEW.next_seq IS NOT (SELECT COUNT(*) FROM punches WHERE work_day_id=NEW.id)
    OR NEW.last_at IS NOT (SELECT MAX(recorded_at) FROM punches WHERE work_day_id=NEW.id)
    OR (SELECT SUM(p.seq) FROM punches p WHERE p.work_day_id=NEW.id)
       IS NOT NEW.next_seq * (NEW.next_seq - 1) / 2
    OR EXISTS (
      SELECT 1 FROM punches p WHERE p.work_day_id=NEW.id
        AND (p.employee_id IS NOT NEW.employee_id OR
             p.type IS NOT CASE p.seq
               WHEN 0 THEN 'entry' WHEN 1 THEN 'break_start'
               WHEN 2 THEN 'break_end' ELSE 'exit' END)
    )
    OR EXISTS (
      SELECT 1 FROM punches p
      JOIN punches previous ON previous.work_day_id=p.work_day_id
        AND previous.seq=p.seq-1
      WHERE p.work_day_id=NEW.id
        AND p.recorded_at<previous.recorded_at
    )
  )) THEN RAISE(ABORT,'company_started_workday_state_invalid') END;
END;

-- Conciliação autorizada de um dia legado já iniciado (NULL -> company_id)
-- também deve registrar o snapshot, mantendo a compatibilidade com a 0020.
-- Um legado inconsistente não pode virar um dia empresarial sem conferência.
CREATE TRIGGER company_started_workday_legacy_bind_guard
AFTER UPDATE OF company_id ON work_days
WHEN OLD.company_id IS NULL AND NEW.company_id IS NOT NULL
     AND NEW.next_seq BETWEEN 1 AND 4
BEGIN
  SELECT CASE WHEN (
    NEW.next_seq IS NOT (SELECT COUNT(*) FROM punches WHERE work_day_id=NEW.id)
    OR NEW.last_at IS NOT (SELECT MAX(recorded_at) FROM punches WHERE work_day_id=NEW.id)
    OR (SELECT SUM(p.seq) FROM punches p WHERE p.work_day_id=NEW.id)
       IS NOT NEW.next_seq * (NEW.next_seq - 1) / 2
    OR EXISTS (
      SELECT 1 FROM punches p WHERE p.work_day_id=NEW.id
        AND (p.employee_id IS NOT NEW.employee_id OR
             p.type IS NOT CASE p.seq
               WHEN 0 THEN 'entry' WHEN 1 THEN 'break_start'
               WHEN 2 THEN 'break_end' ELSE 'exit' END)
    )
    OR EXISTS (
      SELECT 1 FROM punches p
      JOIN punches previous ON previous.work_day_id=p.work_day_id
        AND previous.seq=p.seq-1
      WHERE p.work_day_id=NEW.id
        AND p.recorded_at<previous.recorded_at
    )
  ) THEN RAISE(ABORT,'company_started_workday_state_invalid') END;

  INSERT INTO company_started_workday_snapshot_registry (
    work_day_id,company_id,employee_id,work_date,timezone,
    schedule_json,rules_json,created_at
  ) VALUES (
    NEW.id,NEW.company_id,NEW.employee_id,NEW.work_date,NEW.timezone,
    NEW.schedule_json,NEW.rules_json,NEW.created_at
  );
END;

-- Reject binding a legacy zero-sequence day containing historical punches
-- to a company. Such a day cannot legitimately be "unstarted"; an explicit
-- reconciliation is required before it can become enterprise-owned.
CREATE TRIGGER company_unstarted_legacy_orphan_bind_guard
BEFORE UPDATE OF company_id ON work_days
WHEN OLD.company_id IS NULL AND NEW.company_id IS NOT NULL
  AND NEW.next_seq=0
  AND EXISTS (SELECT 1 FROM punches p WHERE p.work_day_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'company_unstarted_punch_history'); END;

-- INSERT OR REPLACE pode substituir implicitamente linhas sem acionar os
-- gatilhos DELETE. AFTER INSERT protege a identidade pelo id e pela chave
-- (employee_id,work_date), mesmo quando o REPLACE usa outro id.
-- INSERT ... ON CONFLICT DO NOTHING no dia já iniciado segue permitido:
-- nesse caso não existe AFTER INSERT porque nenhuma linha foi gravada.
CREATE TRIGGER company_started_workday_insert_guard
AFTER INSERT ON work_days
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM company_started_workday_snapshot_registry r
    WHERE (r.work_day_id=NEW.id OR
           (r.employee_id=NEW.employee_id AND r.work_date=NEW.work_date))
      AND (r.work_day_id IS NOT NEW.id OR r.company_id IS NOT NEW.company_id
        OR r.employee_id IS NOT NEW.employee_id OR r.work_date IS NOT NEW.work_date
        OR r.timezone IS NOT NEW.timezone OR r.schedule_json IS NOT NEW.schedule_json
        OR r.rules_json IS NOT NEW.rules_json OR r.created_at IS NOT NEW.created_at
        OR NEW.next_seq IS NOT (SELECT COUNT(*) FROM punches WHERE work_day_id=NEW.id)
        OR NEW.last_at IS NOT (SELECT MAX(recorded_at) FROM punches WHERE work_day_id=NEW.id))
  ) OR (
    NEW.company_id IS NOT NULL AND NEW.next_seq BETWEEN 1 AND 4
    AND NOT EXISTS (
      SELECT 1 FROM company_started_workday_snapshot_registry r
      WHERE r.work_day_id=NEW.id
    )
  ) THEN RAISE(ABORT,'company_started_workday_immutable') END;
END;
