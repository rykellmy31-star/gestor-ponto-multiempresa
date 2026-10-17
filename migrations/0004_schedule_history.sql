
-- 0004_schedule_history.sql
-- Historico de alteracoes das jornadas.
-- Preserva os horarios anteriores e permite
-- aplicar novos horarios em datas futuras.

CREATE TABLE IF NOT EXISTS schedule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL
    REFERENCES schedules(id),
  effective_from TEXT NOT NULL
    CHECK(length(effective_from) = 10),
  name TEXT NOT NULL,
  config_json TEXT NOT NULL
    CHECK(json_valid(config_json)),
  changed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- Facilita encontrar a jornada valida
-- em determinada data.

CREATE INDEX IF NOT EXISTS
  schedule_history_lookup
ON schedule_history (
  schedule_id,
  effective_from DESC,
  id DESC
);

-- Guarda a configuracao original de
-- jornadas que ja existirem no banco.

INSERT INTO schedule_history (
  schedule_id,
  effective_from,
  name,
  config_json,
  changed_by,
  created_at
)
SELECT
  s.id,
  '1900-01-01',
  s.name,
  s.config_json,
  s.created_by,
  s.created_at
FROM schedules s
WHERE NOT EXISTS (
  SELECT 1
  FROM schedule_history h
  WHERE h.schedule_id = s.id
);

-- Impede modificar registros historicos.

CREATE TRIGGER IF NOT EXISTS
  schedule_history_no_update
BEFORE UPDATE ON schedule_history
BEGIN
  SELECT RAISE(
    ABORT,
    'schedule_history_immutable'
  );
END;

CREATE TRIGGER IF NOT EXISTS
  schedule_history_no_delete
BEFORE DELETE ON schedule_history
BEGIN
  SELECT RAISE(
    ABORT,
    'schedule_history_immutable'
  );
END;

-- Atualiza a revisao dos dados
-- quando uma versao historica for criada.

CREATE TRIGGER IF NOT EXISTS
  revision_schedule_history_insert
AFTER INSERT ON schedule_history
BEGIN
  UPDATE data_revision
  SET value = value + 1
  WHERE id = 1;
END;
