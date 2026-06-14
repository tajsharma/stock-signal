-- AlterTable: add store-level reorder policy knobs
ALTER TABLE "StoreSettings" ADD COLUMN "safetyBufferDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "StoreSettings" ADD COLUMN "reorderCoverageDays" INTEGER NOT NULL DEFAULT 30;

-- RedefineTable: drop Variant.safetyBufferDays (moved to StoreSettings)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "price" REAL NOT NULL DEFAULT 0,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,
    "productStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "productCreatedAt" DATETIME NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Variant" ("id", "shop", "productId", "productTitle", "variantTitle", "sku", "price", "inventoryQuantity", "productStatus", "productCreatedAt", "leadTimeDays", "updatedAt") SELECT "id", "shop", "productId", "productTitle", "variantTitle", "sku", "price", "inventoryQuantity", "productStatus", "productCreatedAt", "leadTimeDays", "updatedAt" FROM "Variant";
DROP TABLE "Variant";
ALTER TABLE "new_Variant" RENAME TO "Variant";
CREATE INDEX "Variant_shop_idx" ON "Variant"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
