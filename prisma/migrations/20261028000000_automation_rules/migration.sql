-- Point 7: per-rule automations with manual enrollment and run history.

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'automation';

CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "params" JSONB NOT NULL DEFAULT '{}',
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "patient_id" TEXT,
    "cycle_id" TEXT,
    "treatment_id" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_rules_organization_id_key_key" ON "automation_rules"("organization_id", "key");
CREATE UNIQUE INDEX "automation_rules_organization_id_id_key" ON "automation_rules"("organization_id", "id");
CREATE UNIQUE INDEX "automation_runs_organization_id_rule_key_subject_key_key" ON "automation_runs"("organization_id", "rule_key", "subject_key");
CREATE INDEX "automation_runs_organization_id_created_at_idx" ON "automation_runs"("organization_id", "created_at");

ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_automation_rules ON "automation_rules"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_automation_runs ON "automation_runs"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
