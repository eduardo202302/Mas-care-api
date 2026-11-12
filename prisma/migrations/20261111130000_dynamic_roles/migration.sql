-- Roles become fully dynamic: permissions and branch access are stored on the role
-- instead of being derived from the five built-in roles that lived in code.
ALTER TABLE "roles" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "roles" ADD COLUMN "all_branches" BOOLEAN NOT NULL DEFAULT false;

-- Every organization gets one "Master" role (all permissions, all branches). An existing
-- Master is kept (and keeps its menu); organizations without one get it created.
-- Members without a role (the old built-in owner/admin/pharmacist/operator/read_only
-- members) are assigned to Master. roles has row-level security, so the tenant is set
-- for each organization.
DO $$
DECLARE
  org RECORD;
  master_id TEXT;
  all_actions TEXT[] := ARRAY['branches:read', 'branches:write', 'patients:read', 'patients:write', 'patients:archive', 'medications:read', 'medications:write', 'treatments:read', 'treatments:write', 'treatments:manage', 'dashboard:read', 'tasks:read', 'tasks:write', 'templates:read', 'templates:write', 'imports:write', 'settings:read', 'settings:write', 'audit:read', 'users:write', 'roles:read', 'roles:write', 'cycle:move', 'cycle:edit-date', 'stock:mark', 'incident:create', 'incident:move', 'incident:resolve', 'automation:manage', 'outbox:view', 'outbox:retry', 'inbound:assign', 'patient:transfer', 'export:csv', 'doctors:read', 'doctors:write', 'specialties:read', 'specialties:write', 'medical-centers:read', 'medical-centers:write', 'health-conditions:read', 'health-conditions:write', 'dose:log', 'dose:correct', 'inventory:purchase', 'inventory:adjust', 'inventory:settings:write'];
BEGIN
  FOR org IN SELECT id FROM organization LOOP
    PERFORM set_config('app.organization_id', org.id, true);
    SELECT id INTO master_id FROM roles WHERE organization_id = org.id AND name = 'Master' LIMIT 1;
    IF master_id IS NULL THEN
      master_id := 'cm' || substr(md5(random()::text || org.id || clock_timestamp()::text), 1, 23);
      INSERT INTO roles (id, organization_id, key, name, description, base_role, is_system, is_active, updated_at, permissions, all_branches)
      VALUES (master_id, org.id, 'master', 'Master', 'Acceso total a la organización.', 'admin', true, true, now(), all_actions, true);
      INSERT INTO role_menu_items (organization_id, role_id, menu_item_id, can_view, can_create, can_edit, can_delete)
      SELECT org.id, master_id, id, true, true, true, true FROM menu_items;
    ELSE
      UPDATE roles
      SET key = 'master', is_system = true, is_active = true, permissions = all_actions, all_branches = true
      WHERE id = master_id;
      UPDATE role_menu_items SET can_view = true, can_create = true, can_edit = true, can_delete = true WHERE role_id = master_id;
      INSERT INTO role_menu_items (organization_id, role_id, menu_item_id, can_view, can_create, can_edit, can_delete)
      SELECT org.id, master_id, m.id, true, true, true, true FROM menu_items m
      WHERE NOT EXISTS (SELECT 1 FROM role_menu_items r WHERE r.role_id = master_id AND r.menu_item_id = m.id);
    END IF;
    UPDATE member SET "roleId" = master_id WHERE "organizationId" = org.id AND "roleId" IS NULL;
  END LOOP;
END
$$;

-- Better Auth keeps its own role string on member: only the organization owner stays "owner";
-- everyone else is a plain "member". What a person can do comes from their role row.
UPDATE member SET role = 'member' WHERE role <> 'owner';

ALTER TABLE "roles" DROP COLUMN "base_role";
