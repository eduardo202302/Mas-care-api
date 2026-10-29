-- Worker health: one row per background job with its last run and failure counters.
-- Platform-wide (no patient or organization data), read only by the platform owner.
CREATE TABLE "job_runs" (
    "job_name" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_started_at" TIMESTAMP(3),
    "last_finished_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_error" TEXT,
    "last_failure_at" TIMESTAMP(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job_name")
);

INSERT INTO "menu_items" ("id","key","label","path","icon","order","permission","parent_id","updated_at") VALUES
  ('menu_trabajos','trabajos','Trabajos','/trabajos','activity',31,'companies:write',NULL,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
