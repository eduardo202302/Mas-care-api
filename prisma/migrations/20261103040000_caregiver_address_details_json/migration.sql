ALTER TABLE "patient_caregivers" ADD COLUMN "address_details" JSONB;
UPDATE "patient_caregivers" SET "address_details" = jsonb_strip_nulls(jsonb_build_object(
  'address', "address"
)) WHERE "address" IS NOT NULL;
ALTER TABLE "patient_caregivers" DROP COLUMN "address";
