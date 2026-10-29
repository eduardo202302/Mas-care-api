-- Avisos: queue of automatic notices and unassigned replies (needs outbox:view).
INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_avisos','avisos','Avisos','/avisos','send',17,'outbox:view',NULL,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
