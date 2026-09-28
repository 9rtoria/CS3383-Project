package com.example.kanbanplanner.service;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;

class TestIdGenerator extends IdGenerator {

    private final Deque<String> planIds;
    private final Deque<String> bucketIds;
    private final Deque<String> taskIds;
    private final Deque<String> checklistIds;

    TestIdGenerator(
            Collection<String> planIds,
            Collection<String> bucketIds,
            Collection<String> taskIds,
            Collection<String> checklistIds) {
        this.planIds = new ArrayDeque<>(planIds);
        this.bucketIds = new ArrayDeque<>(bucketIds);
        this.taskIds = new ArrayDeque<>(taskIds);
        this.checklistIds = new ArrayDeque<>(checklistIds);
    }

    @Override
    String nextPlanId() {
        return pollRequired(planIds, "plan");
    }

    @Override
    String nextBucketId() {
        return pollRequired(bucketIds, "bucket");
    }

    @Override
    String nextTaskId() {
        return pollRequired(taskIds, "task");
    }

    @Override
    String nextChecklistItemId() {
        return pollRequired(checklistIds, "checklist");
    }

    private String pollRequired(Deque<String> ids, String type) {
        String value = ids.pollFirst();
        if (value == null) {
            throw new IllegalStateException("No more " + type + " ids configured for test");
        }
        return value;
    }
}
