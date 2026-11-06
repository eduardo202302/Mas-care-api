-- Adds non-daily frequency modes to DoseSchedule (interval-hours/days, weekday-specific)
-- and a lightweight grouping id on Treatment so several medications added together
-- from one patient's health-profile session can be shown together. Purely additive:
-- every new column is optional or has a default that reproduces today's behavior
-- exactly (frequency_type defaults to 'daily', applying `times` to every calendar day
-- like before this migration existed), so no existing row changes meaning.

CREATE TYPE "dose_frequency_type" AS ENUM ('daily', 'interval', 'weekly');

-- AlterTable
ALTER TABLE "dose_schedules"
  ADD COLUMN "frequency_type" "dose_frequency_type" NOT NULL DEFAULT 'daily',
  ADD COLUMN "interval_hours" INTEGER,
  ADD COLUMN "anchor_at" TIMESTAMP(3),
  ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "treatments"
  ADD COLUMN "prescription_group_id" TEXT;

-- CreateIndex
CREATE INDEX "treatments_organization_id_prescription_group_id_idx" ON "treatments"("organization_id", "prescription_group_id");
