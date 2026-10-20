-- CR JORNADA - CANDIDATA 0029 (SOMENTE TESTES LOCAIS)
-- O login empresarial por CPF NAO depende do apelido global da matricula.
-- Impede que matriculas repetidas entre empresas colidam em login_identifiers.
-- Mantem login/email globais e o apelido de matricula dos funcionarios LEGADOS
-- (company_id IS NULL). Nao apaga identificadores ja existentes.
-- NAO APLICAR EM BANCO REMOTO SEM HOMOLOGACAO/PLANO DE COMPATIBILIDADE.

DROP TRIGGER IF EXISTS identifiers_user_insert;
CREATE TRIGGER identifiers_user_insert AFTER INSERT ON users BEGIN
  INSERT INTO login_identifiers VALUES(NEW.login,NEW.id);
  INSERT INTO login_identifiers SELECT NEW.email,NEW.id
    WHERE NEW.email IS NOT NULL AND lower(NEW.email)!=lower(NEW.login);
  INSERT INTO login_identifiers
    SELECT e.registration,NEW.id FROM employees e
    WHERE e.id=NEW.employee_id AND e.company_id IS NULL
      AND lower(e.registration)!=lower(NEW.login)
      AND (NEW.email IS NULL OR lower(e.registration)!=lower(NEW.email));
END;

DROP TRIGGER IF EXISTS identifiers_user_update;
CREATE TRIGGER identifiers_user_update AFTER UPDATE OF login,email ON users BEGIN
  DELETE FROM login_identifiers WHERE user_id=NEW.id;
  INSERT INTO login_identifiers VALUES(NEW.login,NEW.id);
  INSERT INTO login_identifiers SELECT NEW.email,NEW.id
    WHERE NEW.email IS NOT NULL AND lower(NEW.email)!=lower(NEW.login);
  INSERT INTO login_identifiers
    SELECT e.registration,NEW.id FROM employees e
    WHERE e.id=NEW.employee_id AND e.company_id IS NULL
      AND lower(e.registration)!=lower(NEW.login)
      AND (NEW.email IS NULL OR lower(e.registration)!=lower(NEW.email));
END;

DROP TRIGGER IF EXISTS identifiers_registration;
CREATE TRIGGER identifiers_registration AFTER UPDATE OF registration ON employees BEGIN
  DELETE FROM login_identifiers WHERE user_id IN(SELECT id FROM users WHERE employee_id=NEW.id);
  INSERT INTO login_identifiers SELECT login,id FROM users WHERE employee_id=NEW.id;
  INSERT INTO login_identifiers SELECT email,id FROM users
    WHERE employee_id=NEW.id AND email IS NOT NULL AND lower(email)!=lower(login);
  INSERT INTO login_identifiers SELECT NEW.registration,id FROM users
    WHERE employee_id=NEW.id
      AND NEW.company_id IS NULL
      AND lower(NEW.registration)!=lower(login)
      AND (email IS NULL OR lower(NEW.registration)!=lower(email));
END;
