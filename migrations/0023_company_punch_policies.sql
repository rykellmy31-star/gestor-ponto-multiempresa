-- CR JORNADA 0023 — regras de ponto por empresa.
-- Aditiva, somente para homologacao D1 local. Sem migrar registros antigos.
-- Nenhuma empresa recebe permissao de bater ponto automaticamente.

CREATE TABLE company_punch_policies (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  rules_json TEXT NOT NULL CHECK(
    json_valid(rules_json) AND json_type(rules_json) = 'object'
  ),
  updated_at INTEGER NOT NULL
);

CREATE TRIGGER company_punch_policy_no_delete
BEFORE DELETE ON company_punch_policies
BEGIN SELECT RAISE(ABORT, 'punch_policy_no_delete'); END;

-- Bloqueio cruzado no proprio banco: protecao valida ate para inserts
-- que nao venham da API nova. So restringe dias COM company_id definido.
CREATE TRIGGER punches_company_policy_enabled
BEFORE INSERT ON punches
WHEN EXISTS (
  SELECT 1 FROM work_days d WHERE d.id = NEW.work_day_id
    AND d.company_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM work_days d
  JOIN company_punch_policies pol ON pol.company_id = d.company_id
  WHERE d.id = NEW.work_day_id AND pol.enabled = 1
)
BEGIN SELECT RAISE(ABORT, 'punch_policy_disabled'); END;

-- Um dia empresarial nao aceita novas marcacoes se a vinculacao
-- a empresa mudar ou se o colaborador nao tiver sessao valida no backend.
-- A validacao de sessao de usuario ocorre na operacao SQL da rota, nao
-- no trigger (triggers nao possuem identidade de requisicao).
