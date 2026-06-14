-- AlterTable: urgent-alert throttle on Variant
ALTER TABLE "Variant" ADD COLUMN "lastReorderAlertAt" DATETIME;

-- AlterTable: Phase 5 notification settings
ALTER TABLE "StoreSettings" ADD COLUMN "digestEmail" TEXT;
ALTER TABLE "StoreSettings" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StoreSettings" ADD COLUMN "urgentAlertsEnabled" BOOLEAN NOT NULL DEFAULT true;
