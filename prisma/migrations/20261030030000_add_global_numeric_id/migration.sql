-- Global, cross-table unique identifier.
--
-- One shared sequence backs every table's `numeric_id` column, so values are
-- unique across the *entire* database, not just within one table. Postgres
-- has no native cross-table UNIQUE constraint, so a shared sequence used as
-- every column's DEFAULT is the only way to get true global uniqueness.
--
-- The sequence is intentionally left unowned (no `OWNED BY`): it is shared by
-- 40 tables, so it must outlive any single one of them.
--
-- Adding each column with a volatile DEFAULT (`nextval(...)`) backfills every
-- existing row with a distinct value in the same statement that adds the
-- NOT NULL column -- no separate backfill/UPDATE pass needed, and no window
-- where existing rows are null.
--
-- Scope: every table with its own singular `id` primary key, i.e. a real
-- "record" a user could look up or that could show an ID in a module header.
-- Excluded on purpose (see GRAPH_REPORT / audit notes for detail):
--   - branch_members, medication_stock_marks, role_menu_items: pure
--     composite-key junction/membership tables, nothing to label with an ID.
--   - job_runs: a singleton per-job counters row, not a user-facing record.
CREATE SEQUENCE IF NOT EXISTS "global_numeric_id_seq" AS BIGINT;

ALTER TABLE "branches" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "branches" ADD CONSTRAINT "branches_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "settings" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "settings" ADD CONSTRAINT "settings_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "audit_log" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "patients" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "patients" ADD CONSTRAINT "patients_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "patient_caregivers" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "patient_caregivers" ADD CONSTRAINT "patient_caregivers_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "patient_consents" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "medications" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "medications" ADD CONSTRAINT "medications_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "treatments" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "refill_cycles" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "refill_cycles" ADD CONSTRAINT "refill_cycles_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "outbox_messages" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "notices" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "notices" ADD CONSTRAINT "notices_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "incidents" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "deliveries" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "patient_transfers" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "patient_transfers" ADD CONSTRAINT "patient_transfers_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "patient_transfer_treatments" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "patient_transfer_treatments" ADD CONSTRAINT "patient_transfer_treatments_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "activities" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "activities" ADD CONSTRAINT "activities_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "saved_views" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "tasks" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "message_templates" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "import_jobs" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "password_reset_pin" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "password_reset_pin" ADD CONSTRAINT "password_reset_pin_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "menu_items" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "roles" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "roles" ADD CONSTRAINT "roles_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "automation_rules" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "automation_runs" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "pipelines" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "pipeline_stages" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "custom_properties" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "custom_properties" ADD CONSTRAINT "custom_properties_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "whatsapp_inbound" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "whatsapp_accounts" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "telegram_accounts" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "telegram_links" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "telegram_link_tokens" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_numeric_id_key" UNIQUE ("numeric_id");

-- Better-Auth-managed tables (user, session, account, verification,
-- organization, member, invitation). Purely additive: Better Auth's adapter
-- issues INSERT/UPDATE statements with explicit column lists, so an extra
-- DB-defaulted column it never names is invisible to it and does not change
-- its behavior.
ALTER TABLE "user" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "user" ADD CONSTRAINT "user_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "session" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "session" ADD CONSTRAINT "session_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "account" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "account" ADD CONSTRAINT "account_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "verification" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "verification" ADD CONSTRAINT "verification_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "organization" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "organization" ADD CONSTRAINT "organization_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "member" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "member" ADD CONSTRAINT "member_numeric_id_key" UNIQUE ("numeric_id");

ALTER TABLE "invitation" ADD COLUMN "numeric_id" BIGINT NOT NULL DEFAULT nextval('global_numeric_id_seq');
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_numeric_id_key" UNIQUE ("numeric_id");
