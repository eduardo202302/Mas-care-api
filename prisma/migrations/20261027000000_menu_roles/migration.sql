-- Member -> Role link (nullable: NULL means "the system role named by member.role")
ALTER TABLE "member" ADD COLUMN "roleId" TEXT;

CREATE TABLE "menu_items" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "path" TEXT,
  "icon" TEXT NOT NULL DEFAULT 'circle',
  "order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "permission" TEXT,
  "parent_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "key" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "base_role" TEXT NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_menu_items" (
  "organization_id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "menu_item_id" TEXT NOT NULL,
  "can_view" BOOLEAN NOT NULL DEFAULT true,
  "can_create" BOOLEAN NOT NULL DEFAULT false,
  "can_edit" BOOLEAN NOT NULL DEFAULT false,
  "can_delete" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "role_menu_items_pkey" PRIMARY KEY ("role_id", "menu_item_id")
);

CREATE UNIQUE INDEX "menu_items_key_key" ON "menu_items"("key");
CREATE UNIQUE INDEX "menu_items_path_key" ON "menu_items"("path");
CREATE INDEX "menu_items_parent_id_idx" ON "menu_items"("parent_id");
CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "roles"("organization_id", "id");
CREATE UNIQUE INDEX "roles_organization_id_name_key" ON "roles"("organization_id", "name");
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");
CREATE INDEX "role_menu_items_organization_id_idx" ON "role_menu_items"("organization_id");
CREATE INDEX "role_menu_items_menu_item_id_idx" ON "role_menu_items"("menu_item_id");
CREATE INDEX "member_roleId_idx" ON "member"("roleId");

ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_menu_items" ADD CONSTRAINT "role_menu_items_organization_id_role_id_fkey" FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_menu_items" ADD CONSTRAINT "role_menu_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member" ADD CONSTRAINT "member_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "role_menu_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_menu_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_roles ON "roles"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
CREATE POLICY tenant_isolation_role_menu_items ON "role_menu_items"
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

-- Initial global menu catalog (same rows as src/domain/menu-defaults.ts).
INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_inicio','inicio','Panel del día','/inicio','activity',10,NULL,NULL,CURRENT_TIMESTAMP),
  ('menu_tareas','tareas','Tareas','/tareas','list-checks',20,'tasks:read',NULL,CURRENT_TIMESTAMP),
  ('menu_companias','companias','Compañías','/companias','building-2',30,'companies:write',NULL,CURRENT_TIMESTAMP),
  ('menu_pacientes','pacientes','Pacientes','/pacientes','users',40,NULL,NULL,CURRENT_TIMESTAMP),
  ('menu_medicamentos','medicamentos','Medicamentos','/medicamentos','pill',50,NULL,NULL,CURRENT_TIMESTAMP),
  ('menu_ajustes','ajustes','Ajustes',NULL,'settings-2',60,NULL,NULL,CURRENT_TIMESTAMP);
INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_sucursales','sucursales','Sucursales','/ajustes/sucursales','store',61,NULL,'menu_ajustes',CURRENT_TIMESTAMP),
  ('menu_usuarios','usuarios','Usuarios','/ajustes/usuarios','user-round',62,NULL,'menu_ajustes',CURRENT_TIMESTAMP),
  ('menu_plantillas','plantillas','Plantillas','/ajustes/plantillas','message-square-text',63,'templates:read','menu_ajustes',CURRENT_TIMESTAMP),
  ('menu_umbrales','umbrales','Umbrales','/ajustes/umbrales','sliders-horizontal',64,'settings:read','menu_ajustes',CURRENT_TIMESTAMP),
  ('menu_roles','roles','Roles','/ajustes/roles','shield-check',65,'roles:read','menu_ajustes',CURRENT_TIMESTAMP),
  ('menu_menu','menu','Menú','/ajustes/menu','list-tree',66,'menu:write','menu_ajustes',CURRENT_TIMESTAMP);
-- System roles and their menu assignments are created per organization by the
-- API (ensureSystemRoles) the first time they are needed.
