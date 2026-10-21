-- CR JORNADA — CANDIDATA 0030 / D1 LOCAL, NAO PUBLICAR.
-- Abordagem aditiva: nenhuma tabela e reconstruida, renomeada ou excluida.
-- Deixa intencionalmente intacta a coluna legada employees.registration,
-- cuja UNIQUE global e usada por codigo legado e login_identifiers.
-- company_registration armazena a matricula exibida aos usuarios da empresa;
-- employees.registration permanece como chave tecnicamente unica global.
-- ATENCAO: antes de implantar, o backend/relatorios/CSV devem ler e escrever
-- COALESCE(company_registration,registration) em contextos empresariais.
-- Ao criar empregado em uma nova empresa, a aplicacao DEVE gerar um token
-- globalmente unico (ex.: UUID) na coluna registration e gravar a matricula
-- informada pelo usuario em company_registration. Nao usar a matricula
-- informada em registration quando ela ja existir globalmente.
-- A coluna aceita NULL para nao quebrar fluxos legados ainda em transicao.
-- A candidata 0029 dos aliases e uma alteracao SEPARADA, nao requisito DDL.

ALTER TABLE employees ADD COLUMN company_registration TEXT
  CHECK(company_registration IS NULL OR length(trim(company_registration)) > 0);

-- Replica as matriculas existentes sem alterar um unico identificador legado.
UPDATE employees SET company_registration = registration
  WHERE company_id IS NOT NULL AND company_registration IS NULL;

-- A comparacao usa o cadastro empresarial quando definido; se ainda nao
-- definido, usa a matricula legada. Archived/deleted pode reutilizar codigo.
CREATE UNIQUE INDEX employees_company_visible_registration_unique
  ON employees(company_id, COALESCE(company_registration,registration) COLLATE NOCASE)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX employees_company_visible_registration_lookup
  ON employees(company_id, COALESCE(company_registration,registration) COLLATE NOCASE);
