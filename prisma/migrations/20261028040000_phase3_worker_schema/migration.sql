-- Phase 3 (worker, WhatsApp): template metadata, pause flags, auto incidents, inbound messages.

CREATE TYPE "wa_template_status" AS ENUM ('draft', 'pending', 'approved', 'rejected');

ALTER TABLE "message_templates"
  ADD COLUMN "wa_template_name" TEXT,
  ADD COLUMN "wa_language" TEXT NOT NULL DEFAULT 'es',
  ADD COLUMN "wa_status" "wa_template_status" NOT NULL DEFAULT 'draft',
  ADD COLUMN "wa_category" TEXT,
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "patients"
  ADD COLUMN "automation_paused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "automation_paused_reason" TEXT;

ALTER TABLE "treatments" ADD COLUMN "automation_paused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "incidents" ADD COLUMN "auto_generated" BOOLEAN NOT NULL DEFAULT false;

-- At most one open incident per cycle and type, so the engine can never pile up duplicates.
CREATE UNIQUE INDEX "incidents_one_open_per_cycle_type_idx"
  ON "incidents"("organization_id", "cycle_id", "type")
  WHERE "cycle_id" IS NOT NULL AND "status" <> 'resolved';

CREATE TABLE "whatsapp_inbound" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "from_phone" TEXT NOT NULL,
    "patient_id" TEXT,
    "cycle_id" TEXT,
    "text" TEXT,
    "button_payload" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_inbound_provider_message_id_key" ON "whatsapp_inbound"("provider_message_id");
CREATE UNIQUE INDEX "whatsapp_inbound_organization_id_id_key" ON "whatsapp_inbound"("organization_id", "id");
CREATE INDEX "whatsapp_inbound_organization_id_patient_id_received_at_idx" ON "whatsapp_inbound"("organization_id", "patient_id", "received_at");
CREATE INDEX "whatsapp_inbound_organization_id_processed_at_idx" ON "whatsapp_inbound"("organization_id", "processed_at");

ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_organization_id_cycle_id_fkey"
  FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "refill_cycles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_inbound" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_inbound" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_whatsapp_inbound ON "whatsapp_inbound"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
