-- CreateTable
CREATE TABLE "Variant" (
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
    "safetyBufferDays" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "processedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShopSync" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "lastBackfillAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Variant_shop_idx" ON "Variant"("shop");

-- CreateIndex
CREATE INDEX "OrderLine_shop_variantId_processedAt_idx" ON "OrderLine"("shop", "variantId", "processedAt");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");
