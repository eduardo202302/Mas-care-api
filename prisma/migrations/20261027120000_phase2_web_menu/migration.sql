-- Phase 2 web: board, incidents and stock settings entries in the sidebar.
INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_tablero','tablero','Tablero','/tablero','kanban',15,NULL,NULL,CURRENT_TIMESTAMP),
  ('menu_incidencias','incidencias','Incidencias','/incidencias','triangle-alert',16,NULL,NULL,CURRENT_TIMESTAMP),
  ('menu_existencias','existencias','Existencias','/ajustes/existencias','packages',67,'stock:mark','menu_ajustes',CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "label" = EXCLUDED."label",
  "path" = EXCLUDED."path",
  "icon" = EXCLUDED."icon",
  "order" = EXCLUDED."order",
  "permission" = EXCLUDED."permission",
  "parent_id" = EXCLUDED."parent_id",
  "updated_at" = CURRENT_TIMESTAMP;
