-- CreateTable
CREATE TABLE "label_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "width_mm" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "height_mm" DECIMAL(6,2) NOT NULL DEFAULT 60,
    "orientation" TEXT NOT NULL DEFAULT 'landscape',
    "elements" JSONB NOT NULL DEFAULT '[]',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_numeric_id_key" ON "label_templates"("numeric_id");

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_organization_id_id_key" ON "label_templates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "label_templates_organization_id_is_active_idx" ON "label_templates"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "label_templates_organization_id_branch_id_idx" ON "label_templates"("organization_id", "branch_id");

-- AddForeignKey
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: every new table is tenant-scoped the same way as the rest of the schema.
ALTER TABLE "label_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_label_templates ON "label_templates"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
