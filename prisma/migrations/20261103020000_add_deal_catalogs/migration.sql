-- CreateEnum
CREATE TYPE "DealPipeline" AS ENUM ('sales');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('appointment_scheduled', 'qualified_to_buy', 'presentation_scheduled', 'decision_maker_bought_in', 'contract_sent', 'closed_won', 'closed_lost');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('new_business', 'existing_business');

-- CreateEnum
CREATE TYPE "DealPriority" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "deals"
  ADD COLUMN "pipeline" "DealPipeline" NOT NULL DEFAULT 'sales',
  ADD COLUMN "stage" "DealStage" NOT NULL DEFAULT 'appointment_scheduled',
  ADD COLUMN "deal_type" "DealType" NOT NULL DEFAULT 'new_business',
  ADD COLUMN "priority" "DealPriority" NOT NULL DEFAULT 'medium';

-- CreateTable
CREATE TABLE "deal_line_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq'::regclass),

    CONSTRAINT "deal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_line_items_numeric_id_key" ON "deal_line_items"("numeric_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_line_items_organization_id_id_key" ON "deal_line_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "deal_line_items_organization_id_deal_id_idx" ON "deal_line_items"("organization_id", "deal_id");

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: every new table is tenant-scoped the same way as the rest of the schema.
ALTER TABLE "deal_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_line_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_deal_line_items ON "deal_line_items"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
