package com.example.kanbanplanner.domain;

import java.util.List;

public record Plan(String id, String name, List<Bucket> buckets, List<Task> tasks, List<Progress> progressOrder) {

    public Plan(String id, String name, List<Bucket> buckets, List<Task> tasks) {
        this(id, name, buckets, tasks, null);
    }

    public Plan {
        buckets = buckets == null ? List.of() : List.copyOf(buckets);
        tasks = tasks == null ? List.of() : List.copyOf(tasks);
        progressOrder = normalizeProgressOrder(progressOrder);
    }

    private static List<Progress> normalizeProgressOrder(List<Progress> progressOrder) {
        List<Progress> defaultOrder = Progress.defaultOrder();
        if (progressOrder == null || progressOrder.isEmpty()) {
            return defaultOrder;
        }

        if (progressOrder.size() != defaultOrder.size()) {
            return defaultOrder;
        }

        if (!progressOrder.containsAll(defaultOrder)) {
            return defaultOrder;
        }

        return List.copyOf(progressOrder);
    }
}
