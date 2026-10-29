-- Adds a free-text label for a treatment, independent of its medication.
ALTER TABLE "treatments" ADD COLUMN "name" TEXT;
