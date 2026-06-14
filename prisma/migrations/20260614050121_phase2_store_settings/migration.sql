-- CreateTable
CREATE TABLE "StoreSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "velocityWindowDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" DATETIME NOT NULL
);
