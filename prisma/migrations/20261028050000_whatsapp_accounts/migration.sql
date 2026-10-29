-- Phase 3: per-organization WhatsApp credentials and the two lookups the webhook needs before it knows the tenant.

CREATE TABLE "whatsapp_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_accounts_organization_id_key" ON "whatsapp_accounts"("organization_id");
CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_key" ON "whatsapp_accounts"("phone_number_id");

ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_whatsapp_accounts ON "whatsapp_accounts"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

-- A webhook arrives before the tenant is known. These functions run with the owner's rights (SECURITY DEFINER)
-- and return only an organization id, so the runtime role never reads other tenants' rows directly.
CREATE FUNCTION whatsapp_org_for_phone_number(p_phone_number_id TEXT) RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT organization_id FROM whatsapp_accounts WHERE phone_number_id = p_phone_number_id LIMIT 1 $$;

CREATE FUNCTION whatsapp_org_for_provider_message(p_provider_message_id TEXT) RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT organization_id FROM outbox_messages WHERE provider_message_id = p_provider_message_id LIMIT 1 $$;
