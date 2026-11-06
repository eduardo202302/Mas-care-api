-- Dose tracking + inventory ledger, parallel to RefillCycle (which stays "when the pharmacy
-- delivers the next batch"). This is new and independent: "how many units the patient has
-- left and what they actually took".

ALTER TYPE "ContactChannel" ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'email';

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'dose_taken';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'dose_skipped';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'dose_rescheduled';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'dose_corrected';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'external_purchase_recorded';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'inventory_adjusted';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'low_inventory_alert';

ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'dose_followup';
ALTER TYPE "IncidentType" ADD VALUE IF NOT EXISTS 'dose_overdue';

CREATE TYPE "DoseLogStatus" AS ENUM ('scheduled', 'taken', 'skipped', 'rescheduled');
CREATE TYPE "SkipReasonCode" AS ENUM ('patient_unavailable', 'side_effects', 'out_of_stock', 'medical_decision', 'other');
CREATE TYPE "InventoryEntryType" AS ENUM ('initial', 'external_purchase', 'pharmacy_delivery', 'manual_adjustment', 'dose_consumption', 'reversal');

-- AlterTable
ALTER TABLE "treatments" ADD COLUMN "low_inventory_threshold" DECIMAL(10,3);

-- CreateTable
CREATE TABLE "dose_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "dose_per_intake" DECIMAL(8,3) NOT NULL,
    "times" TEXT[],
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "authorized_by" TEXT,
    "authorization_note" TEXT,
    "authorization_document_path" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "dose_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dose_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "dose_schedule_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "DoseLogStatus" NOT NULL DEFAULT 'scheduled',
    "nominal_quantity" DECIMAL(8,3) NOT NULL,
    "actual_quantity" DECIMAL(8,3),
    "skip_reason_code" "SkipReasonCode",
    "skip_reason_note" TEXT,
    "rescheduled_for" TIMESTAMP(3),
    "recorded_by" TEXT,
    "recorded_at" TIMESTAMP(3),
    "corrected_by" TEXT,
    "corrected_at" TIMESTAMP(3),
    "correction_note" TEXT,
    "inventory_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "dose_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_purchases" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "presentation" TEXT,
    "purchased_on" DATE NOT NULL,
    "place" TEXT,
    "notes" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "external_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "type" "InventoryEntryType" NOT NULL,
    "quantity_delta" DECIMAL(10,3) NOT NULL,
    "delivery_id" TEXT,
    "external_purchase_id" TEXT,
    "dose_log_id" TEXT,
    "reversed_entry_id" TEXT,
    "note" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "inventory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dose_schedules_numeric_id_key" ON "dose_schedules"("numeric_id");
CREATE UNIQUE INDEX "dose_schedules_organization_id_id_key" ON "dose_schedules"("organization_id", "id");
CREATE INDEX "dose_schedules_organization_id_treatment_id_effective_from_idx" ON "dose_schedules"("organization_id", "treatment_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "dose_logs_numeric_id_key" ON "dose_logs"("numeric_id");
CREATE UNIQUE INDEX "dose_logs_organization_id_id_key" ON "dose_logs"("organization_id", "id");
CREATE UNIQUE INDEX "dose_logs_organization_id_dose_schedule_id_scheduled_for_key" ON "dose_logs"("organization_id", "dose_schedule_id", "scheduled_for");
CREATE INDEX "dose_logs_organization_id_treatment_id_scheduled_for_idx" ON "dose_logs"("organization_id", "treatment_id", "scheduled_for");
CREATE INDEX "dose_logs_organization_id_treatment_id_status_idx" ON "dose_logs"("organization_id", "treatment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_purchases_numeric_id_key" ON "external_purchases"("numeric_id");
CREATE UNIQUE INDEX "external_purchases_organization_id_id_key" ON "external_purchases"("organization_id", "id");
CREATE INDEX "external_purchases_organization_id_treatment_id_purchased_on_idx" ON "external_purchases"("organization_id", "treatment_id", "purchased_on");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_entries_numeric_id_key" ON "inventory_entries"("numeric_id");
CREATE UNIQUE INDEX "inventory_entries_organization_id_id_key" ON "inventory_entries"("organization_id", "id");
CREATE UNIQUE INDEX "inventory_entries_external_purchase_id_key" ON "inventory_entries"("external_purchase_id");
CREATE INDEX "inventory_entries_organization_id_treatment_id_created_at_idx" ON "inventory_entries"("organization_id", "treatment_id", "created_at");
CREATE INDEX "inventory_entries_organization_id_dose_log_id_idx" ON "inventory_entries"("organization_id", "dose_log_id");

-- AddForeignKey
ALTER TABLE "dose_schedules" ADD CONSTRAINT "dose_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dose_schedules" ADD CONSTRAINT "dose_schedules_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dose_schedules" ADD CONSTRAINT "dose_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_dose_schedule_id_fkey" FOREIGN KEY ("dose_schedule_id") REFERENCES "dose_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "external_purchases" ADD CONSTRAINT "external_purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_purchases" ADD CONSTRAINT "external_purchases_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_purchases" ADD CONSTRAINT "external_purchases_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_external_purchase_id_fkey" FOREIGN KEY ("external_purchase_id") REFERENCES "external_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_dose_log_id_fkey" FOREIGN KEY ("dose_log_id") REFERENCES "dose_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_reversed_entry_id_fkey" FOREIGN KEY ("reversed_entry_id") REFERENCES "inventory_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security: every new table is tenant-scoped the same way as the rest of the schema.
ALTER TABLE "dose_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dose_schedules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "dose_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dose_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "external_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_purchases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dose_schedules ON "dose_schedules"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_dose_logs ON "dose_logs"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_external_purchases ON "external_purchases"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_inventory_entries ON "inventory_entries"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
