-- Staging first: restricted first access and single-use encrypted invitations.
ALTER TABLE platform_admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
ALTER TABLE platform_admins ADD COLUMN temporary_password_expires_at INTEGER;
CREATE TABLE platform_admin_invitations(
 id TEXT PRIMARY KEY,
 admin_id TEXT NOT NULL REFERENCES platform_admins(id),
 public_jwk TEXT NOT NULL CHECK(json_valid(public_jwk)),
 private_key_wrapped TEXT,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 created_by TEXT NOT NULL REFERENCES platform_admins(id),
 created_at INTEGER NOT NULL,
 CHECK((used_at IS NULL AND private_key_wrapped IS NOT NULL) OR (used_at IS NOT NULL AND private_key_wrapped IS NULL))
);
CREATE UNIQUE INDEX platform_invitation_pending ON platform_admin_invitations(admin_id) WHERE used_at IS NULL;
