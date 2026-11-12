-- Label sizes are now stored in inches (the unit used for printing).
-- Existing templates keep their physical size: millimetres are converted to inches.
ALTER TABLE "label_templates" RENAME COLUMN "width_mm" TO "width_in";
ALTER TABLE "label_templates" RENAME COLUMN "height_mm" TO "height_in";

UPDATE "label_templates"
SET "width_in" = ROUND("width_in" / 25.4, 2),
    "height_in" = ROUND("height_in" / 25.4, 2);

ALTER TABLE "label_templates" ALTER COLUMN "width_in" SET DEFAULT 3;
ALTER TABLE "label_templates" ALTER COLUMN "height_in" SET DEFAULT 3;
