-- Branch: fold address, city, state, postal_code, sector, latitude, longitude into one JSON column
ALTER TABLE "branches" ADD COLUMN "address_details" JSONB;
UPDATE "branches" SET "address_details" = jsonb_strip_nulls(jsonb_build_object(
  'address', "address",
  'region', "state",
  'city', "city",
  'sector', "sector",
  'postalCode', "postal_code",
  'latitude', "latitude",
  'longitude', "longitude"
));
ALTER TABLE "branches" DROP COLUMN "address";
ALTER TABLE "branches" DROP COLUMN "city";
ALTER TABLE "branches" DROP COLUMN "state";
ALTER TABLE "branches" DROP COLUMN "postal_code";
ALTER TABLE "branches" DROP COLUMN "sector";
ALTER TABLE "branches" DROP COLUMN "latitude";
ALTER TABLE "branches" DROP COLUMN "longitude";

-- MedicalCenter: fold address, province, municipality into one JSON column
ALTER TABLE "medical_centers" ADD COLUMN "address_details" JSONB;
UPDATE "medical_centers" SET "address_details" = jsonb_strip_nulls(jsonb_build_object(
  'address', "address",
  'province', "province",
  'municipality', "municipality"
));
ALTER TABLE "medical_centers" DROP COLUMN "address";
ALTER TABLE "medical_centers" DROP COLUMN "province";
ALTER TABLE "medical_centers" DROP COLUMN "municipality";

-- Patient: fold address, zone into one JSON column
ALTER TABLE "patients" ADD COLUMN "address_details" JSONB;
UPDATE "patients" SET "address_details" = jsonb_strip_nulls(jsonb_build_object(
  'address', "address",
  'zone', "zone"
));
ALTER TABLE "patients" DROP COLUMN "address";
ALTER TABLE "patients" DROP COLUMN "zone";
