-- Sub-stages: several stages may share one system status. A cycle may point at one of them;
-- NULL (or a stage of another status) means the first stage of the cycle's current status.
-- Cycle statuses and derived states are untouched.
DROP INDEX "pipeline_stages_pipeline_id_system_status_key";
CREATE INDEX "pipeline_stages_pipeline_id_system_status_idx" ON "pipeline_stages"("pipeline_id", "system_status");

ALTER TABLE "refill_cycles" ADD COLUMN "stage_id" TEXT;
ALTER TABLE "refill_cycles" ADD CONSTRAINT "refill_cycles_stage_id_fkey"
  FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "refill_cycles_organization_id_stage_id_idx" ON "refill_cycles"("organization_id", "stage_id");
