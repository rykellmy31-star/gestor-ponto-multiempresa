-- Invalidação concorrente: login iniciado antes de uma troca de senha ou bloqueio
-- não pode criar uma sessão válida depois da revogação.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER users_auth_version AFTER UPDATE OF password_hash,active ON users
WHEN NEW.password_hash != OLD.password_hash OR NEW.active != OLD.active
BEGIN UPDATE users SET auth_version=OLD.auth_version+1 WHERE id=NEW.id; END;
