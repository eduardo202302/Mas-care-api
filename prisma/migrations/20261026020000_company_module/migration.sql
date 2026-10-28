CREATE TYPE "company_status" AS ENUM ('active', 'inactive');

CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "company_status" NOT NULL DEFAULT 'active',
    "pin" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_pin_key" ON "company"("pin");
