-- Phase 3 chunk 3: outbox_messages and notices (automatic notice pipeline).

CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'cancelled', 'dry_run');
CREATE TYPE "NoticeMode" AS ENUM ('automatic', 'manual');
CREATE TYPE "NoticeStatus" AS ENUM ('sent', 'delivered', 'read', 'failed', 'replied');

CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "treatment_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "locked_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "outbox_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "mode" "NoticeMode" NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'sent',
    "attempt_number" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_messages_organization_id_dedupe_key_key" ON "outbox_messages"("organization_id", "dedupe_key");
CREATE INDEX "outbox_messages_organization_id_status_scheduled_for_idx" ON "outbox_messages"("organization_id", "status", "scheduled_for");
CREATE INDEX "outbox_messages_organization_id_branch_id_status_idx" ON "outbox_messages"("organization_id", "branch_id", "status");
CREATE INDEX "outbox_messages_organization_id_cycle_id_idx" ON "outbox_messages"("organization_id", "cycle_id");

CREATE UNIQUE INDEX "notices_outbox_id_key" ON "notices"("outbox_id");
CREATE INDEX "notices_organization_id_cycle_id_idx" ON "notices"("organization_id", "cycle_id");
CREATE INDEX "notices_organization_id_patient_id_sent_at_idx" ON "notices"("organization_id", "patient_id", "sent_at");

ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_branch_id_fkey"
  FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_treatment_id_fkey"
  FOREIGN KEY ("organization_id", "treatment_id") REFERENCES "treatments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_cycle_id_fkey"
  FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "refill_cycles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_template_id_fkey"
  FOREIGN KEY ("organization_id", "template_id") REFERENCES "message_templates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notices" ADD CONSTRAINT "notices_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_outbox_id_fkey"
  FOREIGN KEY ("outbox_id") REFERENCES "outbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_organization_id_cycle_id_fkey"
  FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "refill_cycles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outbox_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notices" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_outbox_messages ON "outbox_messages"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_notices ON "notices"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
