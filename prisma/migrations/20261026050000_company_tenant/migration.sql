-- Every existing organization must belong to the company that already owns
-- the data. If the database has no company yet this migration cannot infer a
-- tenant and fails explicitly instead of silently leaving orphan rows.
UPDATE "organization"
SET "company_id" = (
  SELECT "id" FROM "company" ORDER BY "created_at" ASC LIMIT 1
)
WHERE "company_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organization" WHERE "company_id" IS NULL) THEN
    RAISE EXCEPTION 'company_tenant: every organization needs a company before backfilling';
  END IF;
END $$;

-- Backfill the company id on every tenant table from its organization. The
-- append-only audit and consent history tables need their guard temporarily
-- disabled for this one-time schema backfill.
ALTER TABLE "audit_log" DISABLE TRIGGER "audit_log_append_only";
ALTER TABLE "patient_consents" DISABLE TRIGGER "patient_consents_append_only";

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
    EXECUTE format('ALTER TABLE %I ADD COLUMN "company_id" TEXT', table_name);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'UPDATE %I AS tenant SET "company_id" = company."company_id"
       FROM "organization" AS company
       WHERE tenant."organization_id" = company."id"',
      table_name
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "company_id" SET NOT NULL', table_name);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("company_id")
       REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE',
      table_name,
      table_name || '_company_id_fkey'
    );
    EXECUTE format('CREATE INDEX %I ON %I("company_id")', table_name || '_company_id_idx', table_name);
  END LOOP;
END $$;

ALTER TABLE "audit_log" ENABLE TRIGGER "audit_log_append_only";
ALTER TABLE "patient_consents" ENABLE TRIGGER "patient_consents_append_only";

-- The company id is derived from the organization on every insert so new
-- records always carry the tenant, even when written by raw SQL or a new
-- module that forgets to set it.
CREATE FUNCTION set_company_from_organization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_company_id TEXT;
BEGIN
  SELECT "company_id" INTO expected_company_id
  FROM "organization"
  WHERE "id" = NEW."organization_id";

  IF expected_company_id IS NULL THEN
    RAISE EXCEPTION 'organization % has no company', NEW."organization_id" USING ERRCODE = '23502';
  END IF;

  IF NEW."company_id" IS NULL THEN
    NEW."company_id" := expected_company_id;
  ELSIF NEW."company_id" <> expected_company_id THEN
    RAISE EXCEPTION 'company_id % does not match organization %', NEW."company_id", NEW."organization_id" USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

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
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "organization_id", "company_id" ON %I
       FOR EACH ROW EXECUTE FUNCTION set_company_from_organization()',
      'set_company_id_' || table_name,
      table_name
    );
  END LOOP;
END $$;
