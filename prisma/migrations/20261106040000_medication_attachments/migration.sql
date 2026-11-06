CREATE TABLE "medication_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'),

    CONSTRAINT "medication_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "medication_attachments_kind_check" CHECK ("kind" IN ('image', 'document'))
);

CREATE UNIQUE INDEX "medication_attachments_numeric_id_key" ON "medication_attachments"("numeric_id");
CREATE UNIQUE INDEX "medication_attachments_organization_id_id_key" ON "medication_attachments"("organization_id", "id");
CREATE INDEX "medication_attachments_organization_id_medication_id_idx"
  ON "medication_attachments"("organization_id", "medication_id");
CREATE UNIQUE INDEX "medication_attachments_one_primary_idx"
  ON "medication_attachments"("organization_id", "medication_id") WHERE "is_primary";

ALTER TABLE "medication_attachments" ADD CONSTRAINT "medication_attachments_organization_id_medication_id_fkey"
  FOREIGN KEY ("organization_id", "medication_id") REFERENCES "medications"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medication_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medication_attachments" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_medication_attachments ON "medication_attachments"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
