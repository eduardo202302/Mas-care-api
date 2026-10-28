-- Phase 3 chunk 1: automation settings (org + branch override) and audit metadata.

ALTER TABLE "settings" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "settings" ADD COLUMN "automation_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "automation_dry_run" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "settings" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Santo_Domingo';
ALTER TABLE "settings" ADD COLUMN "notice_window_start" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "settings" ADD COLUMN "notice_window_end" TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE "settings" ADD COLUMN "auto_call_task_without_consent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN "default_country_code" TEXT NOT NULL DEFAULT 'DO';

-- organization_id was previously globally unique (one row per org); branch_id
-- being nullable lets the same organization have one org-level row
-- (branch_id = NULL) plus one override row per branch.
DROP INDEX "settings_organization_id_key";
CREATE UNIQUE INDEX "settings_organization_id_branch_id_key" ON "settings"("organization_id", "branch_id");

ALTER TABLE "audit_log" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
