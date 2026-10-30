-- Doctors, medical specialties, medical centers and health conditions, plus
-- their many-to-many links to doctors/centers and to patients.

-- CreateEnum
CREATE TYPE "medical_center_type" AS ENUM ('clinic', 'hospital', 'medical_center', 'private_office', 'other');
CREATE TYPE "patient_condition_status" AS ENUM ('active', 'controlled', 'resolved');

-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "license_number" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_specialties" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "medical_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_specialties" (
    "organization_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "specialty_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_specialties_pkey" PRIMARY KEY ("organization_id", "doctor_id", "specialty_id")
);

-- CreateTable
CREATE TABLE "medical_centers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "center_type" "medical_center_type" NOT NULL DEFAULT 'clinic',
    "rnc" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "province" TEXT,
    "municipality" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "medical_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_medical_centers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "medical_center_id" TEXT NOT NULL,
    "office_number" TEXT,
    "position" TEXT,
    "schedule_notes" TEXT,
    "phone_extension" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "doctor_medical_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_conditions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "health_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_doctors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "patient_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_conditions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "health_condition_id" TEXT NOT NULL,
    "status" "patient_condition_status" NOT NULL DEFAULT 'active',
    "diagnosed_on" DATE,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "patient_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: plain uniques/lookups mirroring the Prisma schema's @@unique/@@index.
CREATE UNIQUE INDEX "doctors_numeric_id_key" ON "doctors"("numeric_id");
CREATE UNIQUE INDEX "doctors_organization_id_id_key" ON "doctors"("organization_id", "id");
CREATE INDEX "doctors_organization_id_is_active_idx" ON "doctors"("organization_id", "is_active");
CREATE INDEX "doctors_last_name_trgm_idx" ON "doctors" USING GIN ("last_name" gin_trgm_ops);
CREATE INDEX "doctors_first_name_trgm_idx" ON "doctors" USING GIN ("first_name" gin_trgm_ops);
CREATE INDEX "doctors_license_number_trgm_idx" ON "doctors" USING GIN ("license_number" gin_trgm_ops);
-- Only one active doctor per license per organization; doctors without a license are unrestricted.
CREATE UNIQUE INDEX "doctors_organization_id_license_number_active_key" ON "doctors"("organization_id", "license_number") WHERE "license_number" IS NOT NULL;

CREATE UNIQUE INDEX "medical_specialties_numeric_id_key" ON "medical_specialties"("numeric_id");
CREATE UNIQUE INDEX "medical_specialties_organization_id_id_key" ON "medical_specialties"("organization_id", "id");
CREATE UNIQUE INDEX "medical_specialties_organization_id_name_key" ON "medical_specialties"("organization_id", "name");
CREATE INDEX "medical_specialties_organization_id_is_active_idx" ON "medical_specialties"("organization_id", "is_active");
CREATE INDEX "medical_specialties_name_trgm_idx" ON "medical_specialties" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "doctor_specialties_organization_id_specialty_id_idx" ON "doctor_specialties"("organization_id", "specialty_id");

CREATE UNIQUE INDEX "medical_centers_numeric_id_key" ON "medical_centers"("numeric_id");
CREATE UNIQUE INDEX "medical_centers_organization_id_id_key" ON "medical_centers"("organization_id", "id");
CREATE INDEX "medical_centers_organization_id_is_active_idx" ON "medical_centers"("organization_id", "is_active");
CREATE INDEX "medical_centers_name_trgm_idx" ON "medical_centers" USING GIN ("name" gin_trgm_ops);

CREATE UNIQUE INDEX "doctor_medical_centers_numeric_id_key" ON "doctor_medical_centers"("numeric_id");
CREATE UNIQUE INDEX "doctor_medical_centers_organization_id_id_key" ON "doctor_medical_centers"("organization_id", "id");
CREATE INDEX "doctor_medical_centers_organization_id_doctor_id_idx" ON "doctor_medical_centers"("organization_id", "doctor_id");
CREATE INDEX "doctor_medical_centers_organization_id_medical_center_id_idx" ON "doctor_medical_centers"("organization_id", "medical_center_id");
-- Only one active stint per (doctor, center) pair; a doctor may leave and later rejoin, leaving the old row inactive.
CREATE UNIQUE INDEX "doctor_medical_centers_active_doctor_center_key" ON "doctor_medical_centers"("organization_id", "doctor_id", "medical_center_id") WHERE "is_active" = true;

CREATE UNIQUE INDEX "health_conditions_numeric_id_key" ON "health_conditions"("numeric_id");
CREATE UNIQUE INDEX "health_conditions_organization_id_id_key" ON "health_conditions"("organization_id", "id");
CREATE UNIQUE INDEX "health_conditions_organization_id_name_key" ON "health_conditions"("organization_id", "name");
CREATE INDEX "health_conditions_organization_id_is_active_idx" ON "health_conditions"("organization_id", "is_active");
CREATE INDEX "health_conditions_name_trgm_idx" ON "health_conditions" USING GIN ("name" gin_trgm_ops);

CREATE UNIQUE INDEX "patient_doctors_numeric_id_key" ON "patient_doctors"("numeric_id");
CREATE UNIQUE INDEX "patient_doctors_organization_id_id_key" ON "patient_doctors"("organization_id", "id");
CREATE INDEX "patient_doctors_organization_id_patient_id_is_active_idx" ON "patient_doctors"("organization_id", "patient_id", "is_active");
CREATE INDEX "patient_doctors_organization_id_doctor_id_idx" ON "patient_doctors"("organization_id", "doctor_id");
-- Only one active link per (patient, doctor) pair.
CREATE UNIQUE INDEX "patient_doctors_active_patient_doctor_key" ON "patient_doctors"("organization_id", "patient_id", "doctor_id") WHERE "is_active" = true;
-- Only one active primary doctor per patient.
CREATE UNIQUE INDEX "patient_doctors_active_primary_key" ON "patient_doctors"("organization_id", "patient_id") WHERE "is_primary" = true AND "is_active" = true;

CREATE UNIQUE INDEX "patient_conditions_numeric_id_key" ON "patient_conditions"("numeric_id");
CREATE UNIQUE INDEX "patient_conditions_organization_id_id_key" ON "patient_conditions"("organization_id", "id");
CREATE INDEX "patient_conditions_organization_id_patient_id_is_active_idx" ON "patient_conditions"("organization_id", "patient_id", "is_active");
CREATE INDEX "patient_conditions_organization_id_health_condition_id_idx" ON "patient_conditions"("organization_id", "health_condition_id");
-- Only one active link per (patient, condition) pair; status changes update this row and are tracked by the audit log.
CREATE UNIQUE INDEX "patient_conditions_active_patient_condition_key" ON "patient_conditions"("organization_id", "patient_id", "health_condition_id") WHERE "is_active" = true;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medical_specialties" ADD CONSTRAINT "medical_specialties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_organization_id_doctor_id_fkey" FOREIGN KEY ("organization_id", "doctor_id") REFERENCES "doctors"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_organization_id_specialty_id_fkey" FOREIGN KEY ("organization_id", "specialty_id") REFERENCES "medical_specialties"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medical_centers" ADD CONSTRAINT "medical_centers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_medical_centers" ADD CONSTRAINT "doctor_medical_centers_organization_id_doctor_id_fkey" FOREIGN KEY ("organization_id", "doctor_id") REFERENCES "doctors"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_medical_centers" ADD CONSTRAINT "doctor_medical_centers_organization_id_medical_center_id_fkey" FOREIGN KEY ("organization_id", "medical_center_id") REFERENCES "medical_centers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_conditions" ADD CONSTRAINT "health_conditions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_doctors" ADD CONSTRAINT "patient_doctors_organization_id_patient_id_fkey" FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_doctors" ADD CONSTRAINT "patient_doctors_organization_id_doctor_id_fkey" FOREIGN KEY ("organization_id", "doctor_id") REFERENCES "doctors"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_organization_id_patient_id_fkey" FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_organization_id_health_condition_id_fkey" FOREIGN KEY ("organization_id", "health_condition_id") REFERENCES "health_conditions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security: every new table is tenant-scoped the same way as the rest of the schema.
ALTER TABLE "doctors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctors" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_doctors ON "doctors"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "medical_specialties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_specialties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_medical_specialties ON "medical_specialties"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "doctor_specialties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_specialties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_doctor_specialties ON "doctor_specialties"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "medical_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_medical_centers ON "medical_centers"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "doctor_medical_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_medical_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_doctor_medical_centers ON "doctor_medical_centers"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "health_conditions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_conditions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_health_conditions ON "health_conditions"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "patient_doctors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_doctors" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_patient_doctors ON "patient_doctors"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "patient_conditions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_conditions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_patient_conditions ON "patient_conditions"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

-- Menu entries for the four new catalogs (read permission gates visibility; write actions are checked per-action in the routers).
INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_medicos','medicos','Médicos','/medicos','stethoscope',51,'doctors:read',NULL,CURRENT_TIMESTAMP),
  ('menu_especialidades','especialidades','Especialidades','/especialidades','award',52,'specialties:read',NULL,CURRENT_TIMESTAMP),
  ('menu_centros_medicos','centros_medicos','Centros médicos','/centros-medicos','hospital',53,'medical-centers:read',NULL,CURRENT_TIMESTAMP),
  ('menu_condiciones_salud','condiciones_salud','Condiciones de salud','/condiciones-salud','heart-pulse',54,'health-conditions:read',NULL,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
