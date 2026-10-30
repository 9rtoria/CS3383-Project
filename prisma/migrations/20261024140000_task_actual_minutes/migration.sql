-- Time tracked from Focus mode. Kept separate from the original estimate so
-- the planner can compare intention with reality without overwriting either.
ALTER TABLE "Task" ADD COLUMN "actualMinutes" INTEGER;
