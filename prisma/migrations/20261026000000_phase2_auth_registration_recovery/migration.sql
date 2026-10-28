-- Phase 2: User registration with username/phone and PIN-based password recovery.

-- Add username (unique, case-insensitive via collation) and phone to user table.
-- Both are nullable for backward-compatibility with existing rows.
ALTER TABLE "user" ADD COLUMN "username" TEXT;
ALTER TABLE "user" ADD COLUMN "phone"    TEXT;

-- Case-insensitive unique index so 'Alice' and 'alice' are the same username.
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- PIN-based password recovery table.
-- Not tenant-scoped: a user belongs to the platform, not to a single organisation.
CREATE TABLE "password_reset_pin" (
    "id"                     TEXT         NOT NULL,
    "user_id"                TEXT         NOT NULL,
    "pin_hash"               TEXT         NOT NULL,
    "expires_at"             TIMESTAMP(3) NOT NULL,
    "attempts"               INTEGER      NOT NULL DEFAULT 0,
    "used_at"                TIMESTAMP(3),
    "reset_token_hash"       TEXT,
    "reset_token_expires_at" TIMESTAMP(3),
    "password_changed_at"    TIMESTAMP(3),
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pin_pkey" PRIMARY KEY ("id")
);

-- reset_token_hash must be globally unique (it's the lookup key for the final step).
CREATE UNIQUE INDEX "password_reset_pin_reset_token_hash_key"
    ON "password_reset_pin"("reset_token_hash");

-- Fast lookup of active (non-expired, non-used) PINs for a user.
CREATE INDEX "password_reset_pin_user_id_used_at_expires_at_idx"
    ON "password_reset_pin"("user_id", "used_at", "expires_at");

ALTER TABLE "password_reset_pin"
    ADD CONSTRAINT "password_reset_pin_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
