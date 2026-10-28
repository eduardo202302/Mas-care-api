-- PostgreSQL feature required by Prisma's trigram GIN indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('whatsapp', 'call', 'sms');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('note', 'call', 'patient_created', 'patient_updated', 'patient_archived', 'patient_restored', 'consent_recorded');

-- DropIndex
DROP INDEX "patients_organization_id_idx";

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "address" TEXT,
ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "care_notes" TEXT,
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone_has_whatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferred_channel" "ContactChannel" NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "reminder_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reminder_consent_at" TIMESTAMP(3),
ADD COLUMN     "responsible_user_id" TEXT,
ADD COLUMN     "zone" TEXT;

-- CreateTable
CREATE TABLE "patient_caregivers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "patient_caregivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "evidence" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "brand_name" TEXT,
    "generic_name" TEXT,
    "active_ingredient" TEXT,
    "presentation" TEXT NOT NULL,
    "dose_unit" TEXT NOT NULL DEFAULT 'tablet',
    "units_per_package" DECIMAL(8,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "patient_id" TEXT NOT NULL,
    "treatment_id" TEXT,
    "cycle_id" TEXT,
    "body" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "author_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "sort" JSONB NOT NULL DEFAULT '{}',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_caregivers_organization_id_patient_id_idx" ON "patient_caregivers"("organization_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_caregivers_organization_id_id_key" ON "patient_caregivers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "patient_consents_organization_id_patient_id_recorded_at_idx" ON "patient_consents"("organization_id", "patient_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_consents_organization_id_id_key" ON "patient_consents"("organization_id", "id");

-- CreateIndex
CREATE INDEX "medications_organization_id_idx" ON "medications"("organization_id");

-- CreateIndex
CREATE INDEX "medications_brand_name_trgm_idx" ON "medications" USING GIN ("brand_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "medications_generic_name_trgm_idx" ON "medications" USING GIN ("generic_name" gin_trgm_ops);

-- Search active ingredient names with the same partial-match index.
CREATE INDEX "medications_active_ingredient_trgm_idx" ON "medications" USING GIN ("active_ingredient" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "medications_organization_id_id_key" ON "medications"("organization_id", "id");

-- CreateIndex
CREATE INDEX "activities_organization_id_patient_id_occurred_at_idx" ON "activities"("organization_id", "patient_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "activities_organization_id_id_key" ON "activities"("organization_id", "id");

-- CreateIndex
CREATE INDEX "saved_views_organization_id_user_id_entity_idx" ON "saved_views"("organization_id", "user_id", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_organization_id_id_key" ON "saved_views"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_organization_id_user_id_entity_name_key" ON "saved_views"("organization_id", "user_id", "entity", "name");

-- CreateIndex
CREATE INDEX "patients_organization_id_document_id_idx" ON "patients"("organization_id", "document_id");

-- CreateIndex
CREATE INDEX "patients_organization_id_phone_idx" ON "patients"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "patients_organization_id_primary_branch_id_idx" ON "patients"("organization_id", "primary_branch_id");

-- CreateIndex
CREATE INDEX "patients_organization_id_responsible_user_id_idx" ON "patients"("organization_id", "responsible_user_id");

-- CreateIndex
CREATE INDEX "patients_full_name_trgm_idx" ON "patients" USING GIN ("full_name" gin_trgm_ops);

-- Backfill the creator of existing phase-0 patients from the organization owner.
UPDATE "patients" p
SET "created_by" = (
  SELECT m."userId" FROM "member" m
  WHERE m."organizationId" = p."organization_id"
  ORDER BY (m."role" = 'owner') DESC, m."createdAt" ASC
  LIMIT 1
);
ALTER TABLE "patients" ALTER COLUMN "created_by" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_caregivers" ADD CONSTRAINT "patient_caregivers_organization_id_patient_id_fkey" FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_organization_id_patient_id_fkey" FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_patient_id_fkey" FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every new tenant table is protected by forced row-level security.
ALTER TABLE "patient_caregivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_caregivers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_consents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "medications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_patient_caregivers ON "patient_caregivers"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_patient_consents ON "patient_consents"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_medications ON "medications"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_activities ON "activities"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_saved_views ON "saved_views"
  USING (organization_id = current_setting('app.organization_id', true)
    AND user_id = current_setting('app.user_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true)
    AND user_id = current_setting('app.user_id', true));

CREATE FUNCTION reject_patient_consent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'patient_consents is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER patient_consents_append_only BEFORE UPDATE OR DELETE ON "patient_consents"
  FOR EACH ROW EXECUTE FUNCTION reject_patient_consent_mutation();
