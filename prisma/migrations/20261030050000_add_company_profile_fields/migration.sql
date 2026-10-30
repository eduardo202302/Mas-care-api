-- Adds extended company profile fields (owner, firmographics) to organizations.
ALTER TABLE "organization" ADD COLUMN "owner_name" TEXT;
ALTER TABLE "organization" ADD COLUMN "industry" TEXT;
ALTER TABLE "organization" ADD COLUMN "type" TEXT;
ALTER TABLE "organization" ADD COLUMN "city" TEXT;
ALTER TABLE "organization" ADD COLUMN "state" TEXT;
ALTER TABLE "organization" ADD COLUMN "postal_code" TEXT;
ALTER TABLE "organization" ADD COLUMN "employee_count" INTEGER;
ALTER TABLE "organization" ADD COLUMN "annual_revenue" DECIMAL(18,2);
ALTER TABLE "organization" ADD COLUMN "timezone" TEXT;
ALTER TABLE "organization" ADD COLUMN "description" TEXT;
ALTER TABLE "organization" ADD COLUMN "linkedin_url" TEXT;
