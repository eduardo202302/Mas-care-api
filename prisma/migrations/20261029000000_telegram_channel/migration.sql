-- Telegram as a second notice channel: one bot per organization, patients link their own chat.

ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE "ContactChannel" ADD VALUE IF NOT EXISTS 'telegram';

CREATE TABLE "telegram_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bot_username" TEXT NOT NULL,
    "bot_token_enc" TEXT NOT NULL,
    "webhook_key" TEXT NOT NULL,
    "webhook_secret_enc" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_link_tokens" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_accounts_organization_id_key" ON "telegram_accounts"("organization_id");
CREATE UNIQUE INDEX "telegram_accounts_webhook_key_key" ON "telegram_accounts"("webhook_key");
CREATE UNIQUE INDEX "telegram_links_organization_id_patient_id_key" ON "telegram_links"("organization_id", "patient_id");
CREATE INDEX "telegram_links_organization_id_chat_id_idx" ON "telegram_links"("organization_id", "chat_id");
CREATE UNIQUE INDEX "telegram_link_tokens_token_hash_key" ON "telegram_link_tokens"("token_hash");
CREATE INDEX "telegram_link_tokens_organization_id_patient_id_idx" ON "telegram_link_tokens"("organization_id", "patient_id");

ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_organization_id_patient_id_fkey"
  FOREIGN KEY ("organization_id", "patient_id") REFERENCES "patients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telegram_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "telegram_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_links" FORCE ROW LEVEL SECURITY;
ALTER TABLE "telegram_link_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_link_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_telegram_accounts ON "telegram_accounts"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_telegram_links ON "telegram_links"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_telegram_link_tokens ON "telegram_link_tokens"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

-- Inbound messages now come from two channels. WhatsApp identifies the sender by phone, Telegram by chat id.
ALTER TABLE "whatsapp_inbound" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "whatsapp_inbound" ADD COLUMN "from_chat_id" TEXT;
ALTER TABLE "whatsapp_inbound" ALTER COLUMN "from_phone" DROP NOT NULL;

-- The Telegram webhook arrives before the tenant is known; its URL carries an unguessable key.
CREATE FUNCTION telegram_org_for_webhook_key(p_webhook_key TEXT) RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT organization_id FROM telegram_accounts WHERE webhook_key = p_webhook_key LIMIT 1 $$;
