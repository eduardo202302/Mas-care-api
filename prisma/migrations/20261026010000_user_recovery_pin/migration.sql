-- Per-user recovery PIN. The PIN is encrypted (not hashed) because managers
-- need to display it in the user's profile so it can be shared with the user.

ALTER TABLE "user" ADD COLUMN "password_pin_encrypted" TEXT;
ALTER TABLE "user" ADD COLUMN "password_pin_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "password_pin_locked_at" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "password_pin_updated_at" TIMESTAMP(3);
