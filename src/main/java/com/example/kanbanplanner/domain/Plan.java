package com.example.kanbanplanner.domain;

import java.util.List;

public record Plan(String id, String name, List<Bucket> buckets, List<Task> tasks) {

    public Plan {
        buckets = buckets == null ? List.of() : List.copyOf(buckets);
        tasks = tasks == null ? List.of() : List.copyOf(tasks);
    }
}
