-- El prescriptor deja de ser texto libre y pasa a apuntar al médico registrado.
ALTER TABLE "treatments" ADD COLUMN "prescriber_doctor_id" TEXT;

CREATE INDEX "treatments_organization_id_prescriber_doctor_id_idx"
  ON "treatments"("organization_id", "prescriber_doctor_id");

ALTER TABLE "treatments"
  ADD CONSTRAINT "treatments_prescriber_doctor_id_fkey"
  FOREIGN KEY ("prescriber_doctor_id") REFERENCES "doctors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
