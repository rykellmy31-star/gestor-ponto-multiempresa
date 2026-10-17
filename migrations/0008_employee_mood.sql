
-- Termometro de Humor da Equipe
-- Migracao 0008
-- Armazena uma resposta voluntaria por funcionario/dia.
-- Aplicar inicialmente SOMENTE no banco de testes.

CREATE TABLE IF NOT EXISTS employee_moods (
  id TEXT PRIMARY KEY,

  employee_id TEXT NOT NULL
    REFERENCES employees(id),

  mood_date TEXT NOT NULL
    CHECK(length(mood_date) = 10),

  mood TEXT NOT NULL
    CHECK(mood IN (
      'very_happy',
      'good',
      'neutral',
      'sad',
      'stressed'
    )),

  created_at INTEGER NOT NULL,

  UNIQUE(employee_id, mood_date)
);

CREATE INDEX IF NOT EXISTS employee_moods_date
ON employee_moods(mood_date);

CREATE INDEX IF NOT EXISTS employee_moods_employee_date
ON employee_moods(employee_id, mood_date DESC);
