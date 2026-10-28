-- Phase 1.3: daily dashboard, deliveries, tasks, message templates and imports.

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'delivery';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'notice';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'task';

CREATE TYPE "TaskType" AS ENUM ('call', 'renew_prescription', 'prepare_delivery', 'other');
CREATE TYPE "TaskStatus" AS ENUM ('open', 'done', 'cancelled');
CREATE TYPE "MessageChannel" AS ENUM ('whatsapp', 'call');

-- Delivery idempotency: a key can only create one delivery per organization.
ALTER TABLE "deliveries" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "deliveries_organization_id_idempotency_key_key"
  ON "deliveries"("organization_id", "idempotency_key");

CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "due_at" TIMESTAMP(3),
    "assigned_to" TEXT,
    "patient_id" TEXT,
    "treatment_id" TEXT,
    "cycle_id" TEXT,
    "auto_generated" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'refill_notice',
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "column_mapping" JSONB NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "treatments_organization_id_branch_id_coverage_end_on_idx"
  ON "treatments"("organization_id", "branch_id", "coverage_end_on");
CREATE INDEX "treatments_organization_id_prescription_expires_on_idx"
  ON "treatments"("organization_id", "prescription_expires_on");
CREATE INDEX "refill_cycles_organization_id_branch_id_status_closed_at_idx"
  ON "refill_cycles"("organization_id", "branch_id", "status", "closed_at");

CREATE INDEX "tasks_organization_id_branch_id_status_due_at_idx"
  ON "tasks"("organization_id", "branch_id", "status", "due_at");
CREATE INDEX "tasks_organization_id_patient_id_idx" ON "tasks"("organization_id", "patient_id");
CREATE INDEX "tasks_organization_id_treatment_id_idx" ON "tasks"("organization_id", "treatment_id");
CREATE INDEX "tasks_organization_id_assigned_to_status_idx" ON "tasks"("organization_id", "assigned_to", "status");
CREATE INDEX "tasks_organization_id_id_key" ON "tasks"("organization_id", "id");
-- Partial index used by the "Hoy / Vencidas / Próximas" task filters.
CREATE INDEX "tasks_open_idx" ON "tasks"("organization_id", "branch_id", "due_at")
  WHERE "status" = 'open';

CREATE INDEX "message_templates_organization_id_channel_kind_is_active_idx"
  ON "message_templates"("organization_id", "channel", "kind", "is_active");
CREATE INDEX "message_templates_organization_id_branch_id_idx"
  ON "message_templates"("organization_id", "branch_id");
CREATE INDEX "message_templates_organization_id_id_key" ON "message_templates"("organization_id", "id");

CREATE INDEX "import_jobs_organization_id_created_at_idx" ON "import_jobs"("organization_id", "created_at");
CREATE INDEX "import_jobs_organization_id_id_key" ON "import_jobs"("organization_id", "id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "refill_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tasks ON "tasks"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_message_templates ON "message_templates"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_import_jobs ON "import_jobs"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
