-- Phase 3 chunk 4: patient transfers between branches.

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'transfer';

CREATE TABLE "patient_transfers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "from_branch_id" TEXT NOT NULL,
    "to_branch_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "treatments_count" INTEGER NOT NULL,
    "cycles_count" INTEGER NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_transfers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient_transfer_treatments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_transfer_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "cycles_moved_count" INTEGER NOT NULL,

    CONSTRAINT "patient_transfer_treatments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_transfers_organization_id_id_key" ON "patient_transfers"("organization_id", "id");
CREATE UNIQUE INDEX "patient_transfers_organization_id_idempotency_key_key" ON "patient_transfers"("organization_id", "idempotency_key");
CREATE INDEX "patient_transfers_organization_id_patient_id_idx" ON "patient_transfers"("organization_id", "patient_id");
CREATE INDEX "patient_transfers_organization_id_from_branch_id_idx" ON "patient_transfers"("organization_id", "from_branch_id");
CREATE INDEX "patient_transfers_organization_id_to_branch_id_idx" ON "patient_transfers"("organization_id", "to_branch_id");

CREATE UNIQUE INDEX "patient_transfer_treatments_organization_id_id_key" ON "patient_transfer_treatments"("organization_id", "id");
CREATE INDEX "patient_transfer_treatments_organization_id_patient_transfe_idx" ON "patient_transfer_treatments"("organization_id", "patient_transfer_id");
CREATE INDEX "patient_transfer_treatments_organization_id_treatment_id_idx" ON "patient_transfer_treatments"("organization_id", "treatment_id");

ALTER TABLE "patient_transfers" ADD CONSTRAINT "patient_transfers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_transfers" ADD CONSTRAINT "patient_transfers_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_transfers" ADD CONSTRAINT "patient_transfers_organization_id_from_branch_id_fkey"
  FOREIGN KEY ("organization_id", "from_branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_transfers" ADD CONSTRAINT "patient_transfers_organization_id_to_branch_id_fkey"
  FOREIGN KEY ("organization_id", "to_branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_transfers" ADD CONSTRAINT "patient_transfers_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_transfer_treatments" ADD CONSTRAINT "patient_transfer_treatments_patient_transfer_id_fkey"
  FOREIGN KEY ("patient_transfer_id") REFERENCES "patient_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_transfer_treatments" ADD CONSTRAINT "patient_transfer_treatments_treatment_id_fkey"
  FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_transfers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_transfer_treatments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_transfer_treatments" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_patient_transfers ON "patient_transfers"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_patient_transfer_treatments ON "patient_transfer_treatments"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
