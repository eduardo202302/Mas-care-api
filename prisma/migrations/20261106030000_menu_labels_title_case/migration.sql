-- Mayúscula inicial en cada palabra de las etiquetas del menú.
UPDATE "menu_items" SET "label" = 'Panel del Día', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'menu_inicio';
UPDATE "menu_items" SET "label" = 'Parámetros de Tiempo', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'menu_umbrales';
UPDATE "menu_items" SET "label" = 'Etapas del Tablero', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'menu_etapas';
UPDATE "menu_items" SET "label" = 'Centros Médicos', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'menu_centros_medicos';
UPDATE "menu_items" SET "label" = 'Condiciones de Salud', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'menu_condiciones_salud';
