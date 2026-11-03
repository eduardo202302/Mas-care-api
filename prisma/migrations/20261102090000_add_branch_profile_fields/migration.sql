-- Branch profile fields: granular address, description, and manager (encargado) contact.
ALTER TABLE "branches"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "manager_name" TEXT,
  ADD COLUMN "manager_phone" TEXT,
  ADD COLUMN "manager_email" TEXT;
