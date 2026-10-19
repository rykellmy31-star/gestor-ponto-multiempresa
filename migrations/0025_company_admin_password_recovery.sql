-- CR JORNADA 0025: validade da senha provisoria gerada pelo Superadmin.
-- Campo adicional somente em administradores empresariais.
-- NULL preserva os cadastros existentes; redefinicoes tem validade curta.
ALTER TABLE company_admins ADD COLUMN
  temporary_password_expires_at INTEGER
  CHECK(temporary_password_expires_at IS NULL OR temporary_password_expires_at > 0);
