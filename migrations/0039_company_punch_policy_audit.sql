-- Aditiva: aplicar somente no staging isolado durante a homologacao.
-- As migrations 0001-0038 e os snapshots de ponto existentes permanecem intactos.
ALTER TABLE company_punch_policies
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1);

CREATE TABLE company_punch_policy_audit (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  admin_id TEXT NOT NULL REFERENCES company_admins(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  rules_json TEXT NOT NULL CHECK(json_valid(rules_json) AND json_type(rules_json)='object'),
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(company_id,revision)
);
CREATE TRIGGER company_punch_policy_audit_owner
BEFORE INSERT ON company_punch_policy_audit
WHEN NOT EXISTS (SELECT 1 FROM company_admins WHERE id=NEW.admin_id AND company_id=NEW.company_id)
BEGIN SELECT RAISE(ABORT,'policy_audit_company_mismatch'); END;
CREATE TRIGGER company_punch_policy_audit_no_replace
BEFORE INSERT ON company_punch_policy_audit
WHEN EXISTS (SELECT 1 FROM company_punch_policy_audit
  WHERE id=NEW.id OR (company_id=NEW.company_id AND revision=NEW.revision))
BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;
CREATE TRIGGER company_punch_policy_audit_no_update
BEFORE UPDATE ON company_punch_policy_audit
BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;
CREATE TRIGGER company_punch_policy_audit_no_delete
BEFORE DELETE ON company_punch_policy_audit
BEGIN SELECT RAISE(ABORT,'policy_audit_immutable'); END;
