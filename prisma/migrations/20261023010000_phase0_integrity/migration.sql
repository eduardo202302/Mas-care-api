-- Enforce organization ownership for business tables while preserving
-- unrelated database objects that share the Neon database.
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "branch_members"
  ADD CONSTRAINT "branch_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
