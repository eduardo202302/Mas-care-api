-- CreateEnum
CREATE TYPE "CyclePriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "CycleType" AS ENUM ('regular', 'urgent', 'special');

-- AlterTable
ALTER TABLE "refill_cycles" ADD COLUMN "priority" "CyclePriority",
ADD COLUMN "type" "CycleType";
