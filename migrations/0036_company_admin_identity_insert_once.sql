-- CR JORNADA 0036 — CANDIDATA LOCAL, NUNCA APLICAR NO D1 REMOTO SEM HOMOLOGACAO.
-- Aplicar APOS 0027 e as candidatas 0028-0035. Migration incremental aditiva.
-- A 0028 bloqueia UPDATE/DELETE da reserva de identidades administrativas,
-- mas INSERT OR REPLACE no MESMO admin_id/empresa ainda apaga a linha implicitamente
-- com recursive_triggers=OFF, recriando-a com outro rowid (prova auditavel).
-- Nao alterar nem reconstruir a tabela ou o historico existente.
-- Este guard AFTER INSERT, apoiado em um segundo registro imutavel, distingue:
--  * INSERT OR IGNORE duplicado: NO OP, continua permitido (compatibilidade 0028);
--  * INSERT OR REPLACE duplicado: AFTER INSERT ocorre e aborta a transacao;
--  * insercao normal de novo admin: aceita, registra a nova identidade.
-- Guard nao depende de PRAGMA recursive_triggers nem foreign_keys.

CREATE TABLE company_admin_identity_insert_history (
  admin_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL
);

-- Congelar reservas ja existentes ANTES de instalar os gatilhos. Apenas IDs
-- tecnicos e a empresa; sem senhas, CPF, tokens ou dados pessoais.
INSERT INTO company_admin_identity_insert_history(admin_id,company_id)
SELECT admin_id,company_id FROM company_admin_identity_registry;

CREATE TRIGGER company_admin_identity_insert_history_no_update
BEFORE UPDATE ON company_admin_identity_insert_history
BEGIN SELECT RAISE(ABORT,'company_admin_identity_insert_history_immutable'); END;

CREATE TRIGGER company_admin_identity_insert_history_no_delete
BEFORE DELETE ON company_admin_identity_insert_history
BEGIN SELECT RAISE(ABORT,'company_admin_identity_insert_history_immutable'); END;

-- RAISE(ABORT), em vez de UNIQUE isolado, impede que OR REPLACE substitua
-- uma linha do proprio historico quando recursive_triggers estiver OFF.
CREATE TRIGGER company_admin_identity_insert_history_no_replace
BEFORE INSERT ON company_admin_identity_insert_history
WHEN EXISTS (
  SELECT 1 FROM company_admin_identity_insert_history h WHERE h.admin_id=NEW.admin_id
)
BEGIN SELECT RAISE(ABORT,'company_admin_identity_insert_history_immutable'); END;

-- Nao permitir reservas artificiais na tabela auxiliar se FK estiver OFF.
CREATE TRIGGER company_admin_identity_insert_history_company_guard
BEFORE INSERT ON company_admin_identity_insert_history
WHEN NOT EXISTS (
  SELECT 1 FROM company_admin_identity_registry r
  WHERE r.admin_id=NEW.admin_id AND r.company_id=NEW.company_id
)
BEGIN SELECT RAISE(ABORT,'company_admin_identity_insert_history_mismatch'); END;

-- Recolhe insercoes reais da tabela original. IGNORE de linha ja existente
-- nao dispara AFTER INSERT, preservando a operacao legitima da migracao 0028.
CREATE TRIGGER company_admin_identity_registry_insert_once
AFTER INSERT ON company_admin_identity_registry
BEGIN
  SELECT RAISE(ABORT,'company_admin_identity_registry_immutable')
  WHERE EXISTS (
    SELECT 1 FROM company_admin_identity_insert_history h WHERE h.admin_id=NEW.admin_id
  );
  INSERT INTO company_admin_identity_insert_history(admin_id,company_id)
  VALUES(NEW.admin_id,NEW.company_id);
END;
