-- Point 5: custom properties for patients and treatments.

CREATE TABLE "custom_properties" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "group_name" TEXT NOT NULL DEFAULT 'General',
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_properties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_properties_organization_id_entity_key_key" ON "custom_properties"("organization_id", "entity", "key");
CREATE UNIQUE INDEX "custom_properties_organization_id_id_key" ON "custom_properties"("organization_id", "id");

ALTER TABLE "custom_properties" ADD CONSTRAINT "custom_properties_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "custom_properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_properties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_custom_properties ON "custom_properties"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE "patients" ADD COLUMN "custom_values" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "treatments" ADD COLUMN "custom_values" JSONB NOT NULL DEFAULT '{}';

INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_propiedades','propiedades','Propiedades','/ajustes/propiedades','list-tree',69,'settings:write','menu_ajustes',CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
