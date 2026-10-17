-- CreateTable
CREATE TABLE "Unit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chapterNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startPage" INTEGER
);

-- CreateTable
CREATE TABLE "Word" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "headword" TEXT NOT NULL,
    "phonetic" TEXT,
    "pos" TEXT,
    "meaningCn" TEXT NOT NULL,
    "tags" TEXT,
    "bncRank" INTEGER,
    "frqRank" INTEGER,
    "unitId" INTEGER NOT NULL,
    "orderInUnit" INTEGER NOT NULL,
    "page" INTEGER,
    "bookMeaning" TEXT,
    "collocation" TEXT,
    "derived" TEXT,
    "etymology" TEXT,
    "cultureNote" TEXT,
    CONSTRAINT "Word_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WordExample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wordId" INTEGER NOT NULL,
    "en" TEXT NOT NULL,
    "cn" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WordExample_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserWordProgress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "stability" REAL NOT NULL DEFAULT 0,
    "difficulty" REAL NOT NULL DEFAULT 0,
    "dueAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'new',
    "scheduledDays" INTEGER NOT NULL DEFAULT 0,
    "learningSteps" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewAt" DATETIME,
    CONSTRAINT "UserWordProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserWordProgress_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER,
    CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewLog_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dailyNewLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyReviewLimit" INTEGER NOT NULL DEFAULT 200,
    "accent" TEXT NOT NULL DEFAULT 'uk',
    "autoSpeak" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_chapterNo_key" ON "Unit"("chapterNo");

-- CreateIndex
CREATE INDEX "Word_headword_idx" ON "Word"("headword");

-- CreateIndex
CREATE UNIQUE INDEX "Word_unitId_orderInUnit_key" ON "Word"("unitId", "orderInUnit");

-- CreateIndex
CREATE INDEX "WordExample_wordId_idx" ON "WordExample"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE INDEX "UserWordProgress_userId_dueAt_idx" ON "UserWordProgress"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserWordProgress_userId_wordId_key" ON "UserWordProgress"("userId", "wordId");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ReviewLog_wordId_idx" ON "ReviewLog"("wordId");
