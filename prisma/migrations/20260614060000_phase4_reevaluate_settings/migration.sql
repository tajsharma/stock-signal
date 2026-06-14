-- AlterTable: add Surface 2 (re-evaluate) policy knobs
ALTER TABLE "StoreSettings" ADD COLUMN "reevaluateBottomPercent" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "StoreSettings" ADD COLUMN "minActiveDays" INTEGER NOT NULL DEFAULT 30;
