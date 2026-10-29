-- Rename the thresholds screen: it now also holds the notice timing parameters.
UPDATE "menu_items" SET "label" = 'Parámetros de tiempo', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'menu_umbrales';
