-- AlterTable: store mirrored billing plan for email gating
ALTER TABLE "StoreSettings" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
