-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserWordProgress" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserWordProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserWordProgress_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserWordProgress" ("difficulty", "dueAt", "id", "lapses", "lastReviewAt", "learningSteps", "reps", "scheduledDays", "stability", "state", "userId", "wordId") SELECT "difficulty", "dueAt", "id", "lapses", "lastReviewAt", "learningSteps", "reps", "scheduledDays", "stability", "state", "userId", "wordId" FROM "UserWordProgress";
DROP TABLE "UserWordProgress";
ALTER TABLE "new_UserWordProgress" RENAME TO "UserWordProgress";
CREATE INDEX "UserWordProgress_userId_dueAt_idx" ON "UserWordProgress"("userId", "dueAt");
CREATE INDEX "UserWordProgress_userId_createdAt_idx" ON "UserWordProgress"("userId", "createdAt");
CREATE UNIQUE INDEX "UserWordProgress_userId_wordId_key" ON "UserWordProgress"("userId", "wordId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
