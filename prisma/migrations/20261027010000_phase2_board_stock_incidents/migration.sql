-- Phase 2: cycle board, stock marks and incidents.

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'cycle_moved';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'incident';

CREATE TYPE "StockLevel" AS ENUM ('in_stock', 'low', 'out_of_stock');
CREATE TYPE "IncidentType" AS ENUM ('prescription_expired', 'out_of_stock', 'patient_no_response', 'patient_reported');
CREATE TYPE "IncidentStatus" AS ENUM ('new', 'in_progress', 'resolved');

-- Optimistic concurrency and notice counter for drag-and-drop moves.
ALTER TABLE "refill_cycles" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "refill_cycles" ADD COLUMN "notice_attempts" INTEGER NOT NULL DEFAULT 0;

-- Manual board positions are optional: NULL means "use expected_on ordering".
ALTER TABLE "refill_cycles" ALTER COLUMN "board_position" DROP DEFAULT;
ALTER TABLE "refill_cycles" ALTER COLUMN "board_position" DROP NOT NULL;
UPDATE "refill_cycles" SET "board_position" = NULL WHERE "board_position" = 0;

CREATE TABLE "medication_stock_marks" (
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "level" "StockLevel" NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" TEXT NOT NULL,

    CONSTRAINT "medication_stock_marks_pkey" PRIMARY KEY ("branch_id", "medication_id")
);

CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "patient_id" TEXT,
    "treatment_id" TEXT,
    "cycle_id" TEXT,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'new',
    "assigned_to" TEXT,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "created_by" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "board_position" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "medication_stock_marks_organization_id_branch_id_medication_id_key"
  ON "medication_stock_marks"("organization_id", "branch_id", "medication_id");
CREATE INDEX "medication_stock_marks_organization_id_idx"
  ON "medication_stock_marks"("organization_id");
CREATE INDEX "medication_stock_marks_organization_id_medication_id_idx"
  ON "medication_stock_marks"("organization_id", "medication_id");

CREATE UNIQUE INDEX "incidents_organization_id_id_key" ON "incidents"("organization_id", "id");
CREATE INDEX "incidents_organization_id_branch_id_status_board_position_idx"
  ON "incidents"("organization_id", "branch_id", "status", "board_position");
CREATE INDEX "incidents_organization_id_patient_id_idx" ON "incidents"("organization_id", "patient_id");
CREATE INDEX "incidents_organization_id_treatment_id_idx" ON "incidents"("organization_id", "treatment_id");
CREATE INDEX "incidents_organization_id_assigned_to_idx" ON "incidents"("organization_id", "assigned_to");
-- Unresolved incidents are the only ones shown on the board.
CREATE INDEX "incidents_open_idx" ON "incidents"("organization_id", "branch_id", "status")
  WHERE "status" <> 'resolved';

-- Board queries: one column at a time, ordered by manual position.
CREATE INDEX "refill_cycles_organization_id_branch_id_status_board_position_idx"
  ON "refill_cycles"("organization_id", "branch_id", "status", "board_position");
-- Due-today counts over open cycles.
CREATE INDEX "refill_cycles_open_expected_on_idx"
  ON "refill_cycles"("organization_id", "branch_id", "expected_on")
  WHERE "closed_at" IS NULL;

ALTER TABLE "medication_stock_marks" ADD CONSTRAINT "medication_stock_marks_organization_id_branch_id_fkey"
  FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medication_stock_marks" ADD CONSTRAINT "medication_stock_marks_organization_id_medication_id_fkey"
  FOREIGN KEY ("organization_id", "medication_id") REFERENCES "medications"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medication_stock_marks" ADD CONSTRAINT "medication_stock_marks_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_branch_id_fkey"
  FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_treatment_id_fkey"
  FOREIGN KEY ("organization_id", "treatment_id") REFERENCES "treatments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_cycle_id_fkey"
  FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "refill_cycles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_to_fkey"
  FOREIGN KEY ("assigned_to") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "medication_stock_marks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medication_stock_marks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_medication_stock_marks ON "medication_stock_marks"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_incidents ON "incidents"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

