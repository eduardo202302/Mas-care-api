-- CreateEnum
CREATE TYPE "CompanyActivityType" AS ENUM ('note', 'email', 'call', 'meeting', 'task');

-- CreateTable
CREATE TABLE "company_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "CompanyActivityType" NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "contact_name" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "author_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "company_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_activities_numeric_id_key" ON "company_activities"("numeric_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_activities_organization_id_id_key" ON "company_activities"("organization_id", "id");

-- CreateIndex
CREATE INDEX "company_activities_organization_id_type_occurred_at_idx" ON "company_activities"("organization_id", "type", "occurred_at");

-- AddForeignKey
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security: every new table is tenant-scoped the same way as the rest of the schema.
ALTER TABLE "company_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_company_activities ON "company_activities"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
