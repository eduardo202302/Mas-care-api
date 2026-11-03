-- Extends the shared global_numeric_id_seq (see 20261030030000_add_global_numeric_id)
-- to the remaining junction/system tables, at the user's explicit request to use
-- numeric_id as the identifier everywhere, overriding the earlier exclusion.
ALTER TABLE "branch_members" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "doctor_specialties" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "medication_stock_marks" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "medication_stock_marks" ADD CONSTRAINT "medication_stock_marks_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "role_menu_items" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "role_menu_items" ADD CONSTRAINT "role_menu_items_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "job_runs" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_numeric_id_key" UNIQUE ("numeric_id");
