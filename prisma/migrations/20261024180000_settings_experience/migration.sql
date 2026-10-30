-- ProjectA2 personalization fields. All fields are additive so existing
-- settings survive the migration with calm defaults.
ALTER TABLE "UserSettings" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "UserSettings" ADD COLUMN "timeFormat" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "UserSettings" ADD COLUMN "readingSize" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "UserSettings" ADD COLUMN "displayFont" TEXT NOT NULL DEFAULT 'editorial';
ALTER TABLE "UserSettings" ADD COLUMN "accent" TEXT NOT NULL DEFAULT 'moss';
ALTER TABLE "UserSettings" ADD COLUMN "motion" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "UserSettings" ADD COLUMN "startView" TEXT NOT NULL DEFAULT 'today';
ALTER TABLE "UserSettings" ADD COLUMN "planBufferPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN "workdayStart" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "UserSettings" ADD COLUMN "workdayEnd" INTEGER NOT NULL DEFAULT 18;
ALTER TABLE "UserSettings" ADD COLUMN "blockBufferMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN "focusMinutes" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "UserSettings" ADD COLUMN "focusAutoStart" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN "captureCloseAfterAdd" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "UserSettings" ADD COLUMN "featuresJson" TEXT NOT NULL DEFAULT '{"dayFlow":true,"smartPlan":true,"voice":true}';
