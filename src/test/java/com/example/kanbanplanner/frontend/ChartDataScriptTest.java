package com.example.kanbanplanner.frontend;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

class ChartDataScriptTest {

    @Test
    void chartAggregationBoundaryCasesPassInNodeScript() throws Exception {
        Assumptions.assumeTrue(isNodeAvailable(), "Node.js is required to execute frontend chart tests.");

        String script = """
                const assert = require('node:assert/strict');
                const path = require('node:path');
                const {pathToFileURL} = require('node:url');

                (async () => {
                  const chartPath = path.resolve('src/main/resources/static/js/utils/chart-data.js');
                  const chartModule = await import(pathToFileURL(chartPath).href);
                  const {
                    isTaskOverdue,
                    computeProgressBreakdown,
                    computeTasksPerBucket,
                    computeTasksPerPriority,
                    computeOverdueCount
                  } = chartModule;

                  const today = new Date(2026, 9, 20);

                  assert.deepEqual(computeProgressBreakdown([]), {
                    total: 0,
                    values: [
                      {label: 'Not started', count: 0},
                      {label: 'In progress', count: 0},
                      {label: 'Completed', count: 0}
                    ]
                  });

                  const mixed = [
                    {id: 'a', progress: 'Not started', priority: 'Low', bucketId: 'b1', dueDate: '2026-10-19'},
                    {id: 'b', progress: 'In progress', priority: 'Urgent', bucketId: 'b2', dueDate: '2026-10-19'},
                    {id: 'c', progress: 'Completed', priority: 'Important', bucketId: 'b2', dueDate: '2026-10-01'},
                    {id: 'd', progress: 'Not started', priority: 'Medium', bucketId: 'b1', dueDate: ''}
                  ];
                  const progress = computeProgressBreakdown(mixed);
                  assert.equal(progress.total, 4);
                  assert.deepEqual(progress.values.map((entry) => entry.label), ['Not started', 'In progress', 'Completed']);
                  assert.deepEqual(progress.values.map((entry) => entry.count), [2, 1, 1]);

                  const buckets = [
                    {id: 'b1', name: 'To Do'},
                    {id: 'b2', name: 'Doing'},
                    {id: 'b3', name: 'Done'}
                  ];
                  const perBucket = computeTasksPerBucket(mixed, buckets);
                  assert.deepEqual(perBucket, [
                    {bucketId: 'b1', name: 'To Do', count: 2},
                    {bucketId: 'b2', name: 'Doing', count: 2},
                    {bucketId: 'b3', name: 'Done', count: 0}
                  ]);

                  const perPriority = computeTasksPerPriority(mixed);
                  assert.deepEqual(perPriority.map((entry) => entry.label), ['Urgent', 'Important', 'Medium', 'Low']);
                  assert.deepEqual(perPriority.map((entry) => entry.count), [1, 1, 1, 1]);

                  assert.equal(isTaskOverdue({dueDate: '', progress: 'Not started'}, today), false);
                  assert.equal(isTaskOverdue({dueDate: '2026-10-20', progress: 'Not started'}, today), false);
                  assert.equal(isTaskOverdue({dueDate: '2026-10-19', progress: 'In progress'}, today), true);
                  assert.equal(isTaskOverdue({dueDate: '2026-10-19', progress: 'Completed'}, today), false);

                  assert.equal(computeOverdueCount(mixed, today), 2);
                  assert.equal(computeOverdueCount([], today), 0);
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

        assertEquals(0, exitCode, () -> "Frontend chart script failed. Output:\n" + output);
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