-- CreateTable
CREATE TABLE "Unit" (
    "id" SERIAL NOT NULL,
    "chapterNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startPage" INTEGER,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passage" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "orderInUnit" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,

    CONSTRAINT "Passage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Word" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "Word_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordExample" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "en" TEXT NOT NULL,
    "cn" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WordExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWordProgress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'new',
    "scheduledDays" INTEGER NOT NULL DEFAULT 0,
    "learningSteps" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWordProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" INTEGER NOT NULL,
    "dailyNewLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyReviewLimit" INTEGER NOT NULL DEFAULT 200,
    "accent" TEXT NOT NULL DEFAULT 'uk',
    "autoSpeak" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_chapterNo_key" ON "Unit"("chapterNo");

-- CreateIndex
CREATE INDEX "Passage_unitId_idx" ON "Passage"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Passage_unitId_orderInUnit_key" ON "Passage"("unitId", "orderInUnit");

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
CREATE INDEX "UserWordProgress_userId_createdAt_idx" ON "UserWordProgress"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserWordProgress_userId_wordId_key" ON "UserWordProgress"("userId", "wordId");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ReviewLog_wordId_idx" ON "ReviewLog"("wordId");

-- AddForeignKey
ALTER TABLE "Passage" ADD CONSTRAINT "Passage_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWordProgress" ADD CONSTRAINT "UserWordProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWordProgress" ADD CONSTRAINT "UserWordProgress_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
