-- Enum types for treatments, refill cycles and deliveries.
CREATE TYPE "TreatmentStatus" AS ENUM ('active', 'paused', 'finished');

CREATE TYPE "RefillCycleStatus" AS ENUM ('to_notify', 'notified', 'confirmed', 'prepared', 'delivered', 'not_picked_up', 'cancelled');

CREATE TYPE "PickedUpBy" AS ENUM ('patient', 'caregiver', 'home_delivery', 'other');

-- Activity history now records treatment lifecycle events.
ALTER TYPE "ActivityType" ADD VALUE 'treatment_created';
ALTER TYPE "ActivityType" ADD VALUE 'treatment_updated';
ALTER TYPE "ActivityType" ADD VALUE 'treatment_paused';
ALTER TYPE "ActivityType" ADD VALUE 'treatment_finished';
ALTER TYPE "ActivityType" ADD VALUE 'treatment_resumed';
ALTER TYPE "ActivityType" ADD VALUE 'coverage_adjusted';
ALTER TYPE "ActivityType" ADD VALUE 'prescription_renewed';

-- Provisional default until real prescription rules are validated.
ALTER TABLE "settings" ADD COLUMN "prescription_warning_days" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE "treatments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "responsible_user_id" TEXT,
    "dose_per_intake" DECIMAL(8,3) NOT NULL,
    "intakes_per_day" DECIMAL(6,3) NOT NULL,
    "quantity_per_cycle" DECIMAL(10,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "prescriber_name" TEXT,
    "prescription_expires_on" DATE,
    "status" "TreatmentStatus" NOT NULL DEFAULT 'active',
    "status_reason" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "last_delivery_on" DATE,
    "coverage_end_on" DATE,
    "coverage_manually_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "coverage_adjust_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "treatments_positive_dose_check" CHECK ("dose_per_intake" > 0),
    CONSTRAINT "treatments_positive_intakes_check" CHECK ("intakes_per_day" > 0),
    CONSTRAINT "treatments_positive_quantity_check" CHECK ("quantity_per_cycle" > 0)
);

CREATE TABLE "refill_cycles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "status" "RefillCycleStatus" NOT NULL DEFAULT 'to_notify',
    "expected_on" DATE NOT NULL,
    "expected_quantity" DECIMAL(10,2) NOT NULL,
    "suggested_notice_on" DATE,
    "board_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refill_cycles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refill_cycles_positive_quantity_check" CHECK ("expected_quantity" > 0)
);

CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "delivered_on" DATE NOT NULL,
    "delivered_by" TEXT NOT NULL,
    "picked_up_by" "PickedUpBy" NOT NULL,
    "picked_up_by_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deliveries_positive_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX "treatments_organization_id_patient_id_idx" ON "treatments"("organization_id", "patient_id");
CREATE INDEX "treatments_organization_id_branch_id_idx" ON "treatments"("organization_id", "branch_id");
CREATE INDEX "treatments_organization_id_status_idx" ON "treatments"("organization_id", "status");
CREATE INDEX "treatments_organization_id_responsible_user_id_idx" ON "treatments"("organization_id", "responsible_user_id");
CREATE INDEX "treatments_organization_id_coverage_end_on_idx" ON "treatments"("organization_id", "coverage_end_on");
CREATE UNIQUE INDEX "treatments_organization_id_id_key" ON "treatments"("organization_id", "id");

CREATE INDEX "refill_cycles_organization_id_treatment_id_status_idx" ON "refill_cycles"("organization_id", "treatment_id", "status");
CREATE INDEX "refill_cycles_organization_id_expected_on_idx" ON "refill_cycles"("organization_id", "expected_on");
CREATE INDEX "refill_cycles_organization_id_branch_id_idx" ON "refill_cycles"("organization_id", "branch_id");
CREATE UNIQUE INDEX "refill_cycles_organization_id_id_key" ON "refill_cycles"("organization_id", "id");

-- A treatment can only have one cycle that is still open. A cycle is closed by
-- setting closed_at (delivered, not picked up or cancelled); the partial index
-- keeps concurrent creation of a second open cycle impossible.
CREATE UNIQUE INDEX "refill_cycles_one_open_per_treatment"
  ON "refill_cycles"("treatment_id")
  WHERE "closed_at" IS NULL;

CREATE INDEX "deliveries_organization_id_treatment_id_delivered_on_idx" ON "deliveries"("organization_id", "treatment_id", "delivered_on");
CREATE INDEX "deliveries_organization_id_cycle_id_idx" ON "deliveries"("organization_id", "cycle_id");
CREATE INDEX "deliveries_organization_id_branch_id_idx" ON "deliveries"("organization_id", "branch_id");
CREATE UNIQUE INDEX "deliveries_organization_id_id_key" ON "deliveries"("organization_id", "id");

CREATE INDEX "activities_organization_id_treatment_id_occurred_at_idx" ON "activities"("organization_id", "treatment_id", "occurred_at");
CREATE INDEX "activities_organization_id_cycle_id_idx" ON "activities"("organization_id", "cycle_id");

ALTER TABLE "treatments" ADD CONSTRAINT "treatments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refill_cycles" ADD CONSTRAINT "refill_cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refill_cycles" ADD CONSTRAINT "refill_cycles_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refill_cycles" ADD CONSTRAINT "refill_cycles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "refill_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivered_by_fkey" FOREIGN KEY ("delivered_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activities" ADD CONSTRAINT "activities_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "refill_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security: every new tenant table is forced and scoped by the
-- transaction-level organization setting, like the phase-1.1 tables.
ALTER TABLE "treatments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refill_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refill_cycles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deliveries" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_treatments ON "treatments"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_refill_cycles ON "refill_cycles"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_deliveries ON "deliveries"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
