-- Exclusivamente desenvolvimento; não aplicar remotamente sem autorização.
-- CHECK aborta o batch inteiro quando a atualização otimista não afeta uma linha.
CREATE TABLE company_admin_write_guards (
  id TEXT PRIMARY KEY,
  affected_rows INTEGER NOT NULL
    CONSTRAINT company_admin_write_conflict CHECK(affected_rows = 1)
);
