-- CR JORNADA 0022 — solicitacoes comerciais independentes do ponto.
-- Somente staging/D1 local ate homologacao. Sem CPF nem dados trabalhistas.

CREATE TABLE sales_leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 100),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 5 AND 254),
  company TEXT NOT NULL DEFAULT '' CHECK(length(company) <= 120),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 12 AND 1000),
  plan_id TEXT NOT NULL DEFAULT '' CHECK(length(plan_id) <= 50),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','contacted','closed')),
  consent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX sales_leads_created_at ON sales_leads(created_at DESC);
CREATE INDEX sales_leads_status_created_at ON sales_leads(status,created_at DESC);

-- A identidade e os dados recebidos jamais entram na auditoria publica.
-- O evento de alteracao registra somente os identificadores e a acao.
CREATE TRIGGER sales_leads_audit_status
AFTER UPDATE OF status ON sales_leads
WHEN NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO platform_audit_log(
    id,actor_id,action,entity_type,entity_id,details_json,created_at
  ) VALUES(
    lower(hex(randomblob(16))),NULL,
    'sales_lead.status_updated','sales_lead',NEW.id,
    json_object('status',NEW.status),NEW.updated_at
  );
END;
