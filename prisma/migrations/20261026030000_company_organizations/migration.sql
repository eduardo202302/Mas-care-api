ALTER TABLE "organization" ADD COLUMN "company_id" TEXT;

CREATE INDEX "organization_company_id_idx" ON "organization"("company_id");

ALTER TABLE "organization"
  ADD CONSTRAINT "organization_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
