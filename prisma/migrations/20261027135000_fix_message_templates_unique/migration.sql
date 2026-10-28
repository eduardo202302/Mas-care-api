-- Pre-existing drift: the schema declares @@unique([organizationId, id]) on
-- MessageTemplate, but an earlier migration created it as a plain index, not
-- a unique constraint. Phase 3's outbox_messages needs a real unique target
-- to reference with a composite foreign key, so this fixes it in place.

DROP INDEX "message_templates_organization_id_id_key";
CREATE UNIQUE INDEX "message_templates_organization_id_id_key" ON "message_templates"("organization_id", "id");
