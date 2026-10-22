-- CR JORNADA: proposta de migracao 0028 para homologacao EXCLUSIVAMENTE LOCAL.
-- Mantem INSERT / ON CONFLICT DO NOTHING / UPSERT DO UPDATE legitimos.
-- Impede REPLACE destrutivo mesmo se PRAGMA defer_foreign_keys=ON.

-- A migracao 0014 ja criou company_admins_company_immutable; nao duplicar.

-- SQLites TEXT PRIMARY KEY em uma tabela rowid nao proibe strings vazias,
-- nem todos os caracteres de espaco/controle. Validar IDs ja cadastrados
-- ANTES da instalacao de gatilhos de identidade. O CHECK encerra a migracao
-- no D1 transacional, sem alterar administradores preexistentes.
CREATE TABLE _company_admin_id_preflight_0028 (
  invalid_count INTEGER NOT NULL
    CONSTRAINT company_admin_id_preflight CHECK(invalid_count=0)
);
INSERT INTO _company_admin_id_preflight_0028(invalid_count)
SELECT COUNT(*) FROM company_admins
WHERE id IS NULL OR length(trim(id,char(9,10,11,12,13,32)))=0;
DROP TABLE _company_admin_id_preflight_0028;

-- A mesma regra passa a valer para novas contas. Atualizacao de IDs
-- continua bloqueada separadamente por company_admins_id_immutable.
CREATE TRIGGER IF NOT EXISTS company_admins_id_required
BEFORE INSERT ON company_admins
WHEN NEW.id IS NULL OR length(trim(NEW.id,char(9,10,11,12,13,32)))=0
BEGIN SELECT RAISE(ABORT,'company_admin_id_required'); END;

CREATE TRIGGER IF NOT EXISTS company_admins_id_immutable
BEFORE UPDATE OF id ON company_admins
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT, 'company_admin_id_immutable'); END;

-- Identidades emitidas nunca devem ser recicladas por substituicao.
-- Tabela sem FK intencional: deve persistir o identificador mesmo quando
-- SQLite faz DELETE implicito em REPLACE, independentemente de FK deferred.
CREATE TABLE IF NOT EXISTS company_admin_identity_registry (
  admin_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL
);

INSERT OR IGNORE INTO company_admin_identity_registry(admin_id,company_id)
SELECT id,company_id FROM company_admins;

-- Nao permitir que gravacoes acidentais desfaçam a reserva de IDs.
-- Restricao de acesso ao banco continua obrigatoria: quem controla o schema
-- pode remover triggers; esta protecao nao substitui permissoes de D1.
CREATE TRIGGER IF NOT EXISTS company_admin_identity_registry_no_update
BEFORE UPDATE ON company_admin_identity_registry
BEGIN SELECT RAISE(ABORT, 'company_admin_identity_registry_immutable'); END;

CREATE TRIGGER IF NOT EXISTS company_admin_identity_registry_no_delete
BEFORE DELETE ON company_admin_identity_registry
BEGIN SELECT RAISE(ABORT, 'company_admin_identity_registry_immutable'); END;

-- A inclusao de uma reserva somente e valida para o gestor correspondente.
-- Mantemos INSERT OR IGNORE de backfill idempotente compativel:
-- a validacao nao intercepta conflitos normais de chave.
CREATE TRIGGER IF NOT EXISTS company_admin_identity_registry_company_guard
BEFORE INSERT ON company_admin_identity_registry
WHEN NOT EXISTS (
  SELECT 1 FROM company_admins a
  WHERE a.id = NEW.admin_id AND a.company_id = NEW.company_id
)
BEGIN SELECT RAISE(ABORT, 'company_admin_identity_registry_mismatch'); END;

-- AFTER INSERT apenas ocorre quando houve insercao real: nao intercepta
-- DO NOTHING nem o caminho de UPDATE do UPSERT.
CREATE TRIGGER IF NOT EXISTS company_admins_identity_after_insert
AFTER INSERT ON company_admins
BEGIN
  -- Check the primary key first: REPLACE of the same id is never an insert.
  SELECT RAISE(ABORT, 'company_admin_replace_denied')
  WHERE EXISTS (
    SELECT 1 FROM company_admin_identity_registry issued WHERE issued.admin_id=NEW.id
  );
  INSERT INTO company_admin_identity_registry(admin_id,company_id)
  VALUES (NEW.id,NEW.company_id);
  -- DELETE implicit in REPLACE does not fire BEFORE DELETE by default.
  -- Every legitimate new admin increases both counts by one; REPLACE does not.
  SELECT RAISE(ABORT, 'company_admin_replace_denied')
  WHERE (SELECT count(*) FROM company_admins)
     <> (SELECT count(*) FROM company_admin_identity_registry);
END;

-- UPDATE OR REPLACE pode apagar OUTRO gestor ao colidir login/email.
-- O verificador encontra o ID removido e aborta a instrucao integralmente.
CREATE TRIGGER IF NOT EXISTS company_admins_identity_after_update
AFTER UPDATE ON company_admins
BEGIN
  SELECT RAISE(ABORT, 'company_admin_update_replace_denied')
  WHERE (SELECT count(*) FROM company_admins)
     <> (SELECT count(*) FROM company_admin_identity_registry);
END;
