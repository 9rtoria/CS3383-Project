-- Auto-plan preferences and schedule blocks. Preferences are additive; plan
-- blocks live outside Task so replanning never rewrites due dates.
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanMode" TEXT NOT NULL DEFAULT 'suggest';
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanRestMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanWeeklyMinutes" INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanRefreshMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanDeepWorkMinutes" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanSplitLongTasks" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanIncludeWeekends" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanDefaultEstimateMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanCapBehavior" TEXT NOT NULL DEFAULT 'stop';
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanLunchEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanLunchStart" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanLunchEnd" INTEGER NOT NULL DEFAULT 13;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanAllowStaleArchive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN "autoPlanStaleDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "PlanBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlanBlock_userId_date_idx" ON "PlanBlock"("userId", "date");
CREATE INDEX "PlanBlock_workspaceId_date_idx" ON "PlanBlock"("workspaceId", "date");
CREATE INDEX "PlanBlock_taskId_idx" ON "PlanBlock"("taskId");
