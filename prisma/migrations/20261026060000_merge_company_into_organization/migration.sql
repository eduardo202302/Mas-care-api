-- Company is merged into organization: one company == one organization.
-- Company-level fields move to the organization and the company table, its
-- tenant column and the triggers that derived it are removed.

ALTER TYPE "company_status" RENAME TO "organization_status";

ALTER TABLE "organization"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "status" "organization_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "pin" TEXT,
  ADD COLUMN "domain" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill from the owning company. The PIN is unique, so when a company had
-- several organizations only the oldest one keeps it; the rest get a new PIN
-- from the platform owner screen.
UPDATE "organization" AS org
SET "email" = company."email",
    "status" = company."status",
    "domain" = company."domain",
    "logo" = COALESCE(org."logo", company."logo"),
    "updated_at" = company."updated_at"
FROM "company" AS company
WHERE org."company_id" = company."id";

UPDATE "organization" AS org
SET "pin" = company."pin"
FROM "company" AS company
WHERE org."company_id" = company."id"
  AND org."id" = (
    SELECT first_org."id" FROM "organization" AS first_org
    WHERE first_org."company_id" = company."id"
    ORDER BY first_org."createdAt" ASC, first_org."id" ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX "organization_pin_key" ON "organization"("pin");

-- Drop the triggers that derived company_id from organization_id.
DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'branches',
    'branch_members',
    'settings',
    'audit_log',
    'patients',
    'patient_caregivers',
    'patient_consents',
    'medications',
    'treatments',
    'refill_cycles',
    'deliveries',
    'activities',
    'saved_views',
    'tasks',
    'message_templates',
    'import_jobs'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'set_company_id_' || table_name, table_name);
    EXECUTE format('ALTER TABLE %I DROP COLUMN "company_id"', table_name);
  END LOOP;
END $$;

DROP FUNCTION set_company_from_organization();

ALTER TABLE "organization" DROP COLUMN "company_id";

DROP TABLE "company";
