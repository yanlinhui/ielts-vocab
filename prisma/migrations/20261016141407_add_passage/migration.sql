-- CreateTable
CREATE TABLE "Passage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "orderInUnit" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    CONSTRAINT "Passage_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Passage_unitId_idx" ON "Passage"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Passage_unitId_orderInUnit_key" ON "Passage"("unitId", "orderInUnit");
