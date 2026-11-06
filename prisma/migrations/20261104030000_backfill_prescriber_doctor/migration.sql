-- Enlaza los prescriptores ya guardados como texto con su médico registrado.
-- Solo cuando el nombre completo coincide exactamente dentro de la organización
-- y el médico es único, para no atribuir un tratamiento al médico equivocado.
UPDATE "treatments" t
   SET "prescriber_doctor_id" = d."id"
  FROM "doctors" d
 WHERE t."prescriber_doctor_id" IS NULL
   AND t."prescriber_name" IS NOT NULL
   AND d."organization_id" = t."organization_id"
   AND btrim(t."prescriber_name") = btrim(d."first_name" || ' ' || d."last_name")
   AND (
     SELECT count(*)
       FROM "doctors" d2
      WHERE d2."organization_id" = t."organization_id"
        AND btrim(t."prescriber_name") = btrim(d2."first_name" || ' ' || d2."last_name")
   ) = 1;
