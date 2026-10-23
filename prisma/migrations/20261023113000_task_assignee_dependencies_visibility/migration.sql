-- AlterTable
ALTER TABLE "Board" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'workspace';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "assigneeId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnTaskId")
);

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");

-- AddForeignKey
PRAGMA foreign_keys=OFF;
PRAGMA foreign_keys=ON;
