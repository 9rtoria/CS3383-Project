package com.example.kanbanplanner.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlanTest {

    @Test
    void constructorCopiesCollectionsDefensively() {
        List<Bucket> buckets = new ArrayList<>();
        buckets.add(new Bucket("bkt_001", "To Do"));

        List<Task> tasks = new ArrayList<>();
        tasks.add(new Task(
                "tsk_001",
                "Draft report",
                "bkt_001",
                Progress.NOT_STARTED,
                Priority.IMPORTANT,
                null,
                null,
                null,
                List.of()));

        Plan plan = new Plan("pln_001", "Semester Tasks", buckets, tasks);

        buckets.add(new Bucket("bkt_002", "Doing"));
        tasks.add(new Task(
                "tsk_002",
                "Review notes",
                "bkt_001",
                Progress.IN_PROGRESS,
                Priority.MEDIUM,
                null,
                null,
                null,
                List.of()));

        assertEquals(1, plan.buckets().size());
        assertEquals(1, plan.tasks().size());
        assertThrows(UnsupportedOperationException.class, () -> plan.buckets().add(new Bucket("bkt_003", "Done")));
        assertThrows(UnsupportedOperationException.class, () -> plan.tasks().clear());
    }

    @Test
    void constructorUsesEmptyListsWhenNullProvided() {
        Plan plan = new Plan("pln_001", "Semester Tasks", null, null);

        assertTrue(plan.buckets().isEmpty());
        assertTrue(plan.tasks().isEmpty());
    }
}
