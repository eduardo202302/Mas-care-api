ALTER TABLE "patient_conditions" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "patient_conditions_active_primary_key" ON "patient_conditions"("organization_id", "patient_id") WHERE "is_primary" = true AND "is_active" = true;
