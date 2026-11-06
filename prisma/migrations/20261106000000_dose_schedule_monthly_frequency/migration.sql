-- Adds the 'monthly' dose frequency (specific days of the month, e.g. the 5th, 10th and 20th).
-- Purely additive: existing rows keep their frequency_type and get an empty monthdays array.

ALTER TYPE "dose_frequency_type" ADD VALUE 'monthly';

-- AlterTable
ALTER TABLE "dose_schedules"
  ADD COLUMN "monthdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
