-- Módulo de tratamientos: entrada de menú (el permiso de lectura controla la visibilidad).
INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_tratamientos','tratamientos','Tratamientos','/tratamientos','clipboard-list',45,'treatments:read',NULL,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
