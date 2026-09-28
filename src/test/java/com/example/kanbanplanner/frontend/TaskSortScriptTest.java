package com.example.kanbanplanner.frontend;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

class TaskSortScriptTest {

    @Test
    void gridSorterBoundaryCasesPassInNodeScript() throws Exception {
        Assumptions.assumeTrue(isNodeAvailable(), "Node.js is required to execute frontend sorter tests.");

        String script = """
                const assert = require('node:assert/strict');
                const path = require('node:path');
                const {pathToFileURL} = require('node:url');

                (async () => {
                  const sorterPath = path.resolve('src/main/resources/static/js/utils/task-sort.js');
                  const sorterModule = await import(pathToFileURL(sorterPath).href);
                  const {compareTasksByDefaultOrder, sortTasksForGrid} = sorterModule;

                  const baselineTasks = [
                    {id: 't_no_due', title: 'Omega', dueDate: '', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'},
                    {id: 't_due_early_b', title: 'Beta', dueDate: '2026-09-10', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'},
                    {id: 't_due_late', title: 'Gamma', dueDate: '2026-09-11', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'},
                    {id: 't_due_early_a', title: 'Alpha', dueDate: '2026-09-10', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'}
                  ];

                  const defaultSorted = [...baselineTasks].sort(compareTasksByDefaultOrder).map((task) => task.id);
                  assert.deepEqual(defaultSorted, ['t_due_early_a', 't_due_early_b', 't_due_late', 't_no_due']);

                  const mixedCaseTitleTasks = [
                    {id: 'title_b', title: 'Beta', dueDate: '2026-09-12', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'},
                    {id: 'title_a', title: 'alpha', dueDate: '2026-09-12', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'}
                  ];
                  const mixedCaseSorted = [...mixedCaseTitleTasks].sort(compareTasksByDefaultOrder).map((task) => task.id);
                  assert.deepEqual(mixedCaseSorted, ['title_a', 'title_b']);

                  const deterministicTieTasks = [
                    {id: 'id_b', title: 'same', dueDate: '2026-09-10', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'},
                    {id: 'id_a', title: 'same', dueDate: '2026-09-10', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'}
                  ];
                  const deterministicSorted = [...deterministicTieTasks].sort(compareTasksByDefaultOrder).map((task) => task.id);
                  assert.deepEqual(deterministicSorted, ['id_a', 'id_b']);

                  assert.deepEqual(sortTasksForGrid([], {sortKey: 'dueDate', direction: 'asc', bucketNameById: {}}), []);

                  const singleTask = [
                    {id: 'only', title: 'Only', dueDate: '', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'}
                  ];
                  const singleSorted = sortTasksForGrid(singleTask, {sortKey: 'dueDate', direction: 'asc', bucketNameById: {b1: 'To Do'}});
                  assert.equal(singleSorted.length, 1);
                  assert.equal(singleSorted[0].id, 'only');

                  const dueDateDesc = sortTasksForGrid(baselineTasks, {sortKey: 'dueDate', direction: 'desc', bucketNameById: {}});
                  assert.deepEqual(dueDateDesc.map((task) => task.id), ['t_due_late', 't_due_early_a', 't_due_early_b', 't_no_due']);

                  const bucketTasks = [
                    {id: 'bucket_c', title: 'Task 3', dueDate: '', startDate: '', bucketId: 'b3', progress: 'Not started', priority: 'Low'},
                    {id: 'bucket_a', title: 'Task 1', dueDate: '', startDate: '', bucketId: 'b1', progress: 'Not started', priority: 'Low'},
                    {id: 'bucket_b', title: 'Task 2', dueDate: '', startDate: '', bucketId: 'b2', progress: 'Not started', priority: 'Low'}
                  ];

                  const bucketSorted = sortTasksForGrid(bucketTasks, {
                    sortKey: 'bucket',
                    direction: 'asc',
                    bucketNameById: {b1: 'Design', b2: 'Doing', b3: 'To Do'}
                  }).map((task) => task.id);
                  assert.deepEqual(bucketSorted, ['bucket_a', 'bucket_b', 'bucket_c']);
                })().catch((error) => {
                  console.error(error);
                  process.exit(1);
                });
                """;

        Process process = new ProcessBuilder("node", "--eval", script)
                .redirectErrorStream(true)
                .start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exitCode = process.waitFor();

        assertEquals(0, exitCode, () -> "Frontend sorter script failed. Output:\n" + output);
    }

    private boolean isNodeAvailable() {
        try {
            Process process = new ProcessBuilder("node", "--version")
                    .redirectErrorStream(true)
                    .start();
            return process.waitFor() == 0;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return false;
        } catch (IOException ex) {
            return false;
        }
    }
}
