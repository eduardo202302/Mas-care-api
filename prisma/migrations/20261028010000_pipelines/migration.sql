-- Point 1: configurable pipeline and stages (name, description, colour, order).

CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "system_status" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipelines_organization_id_key_key" ON "pipelines"("organization_id", "key");
CREATE UNIQUE INDEX "pipelines_organization_id_id_key" ON "pipelines"("organization_id", "id");
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_system_status_key" ON "pipeline_stages"("pipeline_id", "system_status");
CREATE UNIQUE INDEX "pipeline_stages_organization_id_id_key" ON "pipeline_stages"("organization_id", "id");
CREATE INDEX "pipeline_stages_organization_id_pipeline_id_position_idx" ON "pipeline_stages"("organization_id", "pipeline_id", "position");

ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey"
  FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pipelines ON "pipelines"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_pipeline_stages ON "pipeline_stages"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_etapas','etapas','Etapas del tablero','/ajustes/etapas','kanban',68,'settings:write','menu_ajustes',CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
