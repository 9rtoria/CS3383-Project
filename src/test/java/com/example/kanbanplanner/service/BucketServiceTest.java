package com.example.kanbanplanner.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Priority;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.service.support.InMemoryPlannerRepository;
import com.example.kanbanplanner.validation.PlannerValidator;
import com.example.kanbanplanner.validation.ValidationException;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class BucketServiceTest {

    @Test
    void createBucketEnforcesCaseInsensitiveUniqueness() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan(
                "pln_1",
                "Plan",
                List.of(new Bucket("bkt_1", "Todo")),
                List.of()));

        BucketService service = new BucketService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of("bkt_2"), List.of(), List.of()));

        ValidationException exception = assertThrows(
                ValidationException.class,
                () -> service.createBucket("pln_1", "todo"));

        assertEquals("name", exception.details().get(0).field());
    }

    @Test
    void deleteNonEmptyBucketMovesTasksToExistingUncategorized() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(planWithUncategorized());

        BucketService service = new BucketService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        service.deleteBucket("pln_1", "bkt_work");

        Plan updated = repository.findPlanById("pln_1").orElseThrow();
        assertEquals(2, updated.buckets().size());
        assertTrue(updated.buckets().stream().noneMatch(bucket -> bucket.id().equals("bkt_work")));
        assertTrue(updated.tasks().stream().allMatch(task -> task.bucketId().equals("bkt_uncat")));
    }

    @Test
    void deleteNonEmptyBucketAutoCreatesUncategorizedWhenMissing() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(planWithoutUncategorized());

        BucketService service = new BucketService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of("bkt_uncat_new"), List.of(), List.of()));

        service.deleteBucket("pln_2", "bkt_backlog");

        Plan updated = repository.findPlanById("pln_2").orElseThrow();
        Bucket uncategorized = updated.buckets().stream()
                .filter(bucket -> bucket.name().equals("Uncategorized"))
                .findFirst()
                .orElseThrow();

        assertEquals("bkt_uncat_new", uncategorized.id());
        assertTrue(updated.tasks().stream().allMatch(task -> task.bucketId().equals("bkt_uncat_new")));
    }

    @Test
    void deleteNonEmptyUncategorizedIsBlocked() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        Plan plan = new Plan(
                "pln_3",
                "Plan",
                List.of(new Bucket("bkt_uncat", "Uncategorized")),
                List.of(task("tsk_1", "bkt_uncat", Progress.IN_PROGRESS)));
        repository.savePlan(plan);

        BucketService service = new BucketService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        ValidationException exception = assertThrows(
                ValidationException.class,
                () -> service.deleteBucket("pln_3", "bkt_uncat"));

        assertEquals("bucket", exception.details().get(0).field());
    }

    @Test
    void deleteEmptyUncategorizedSucceeds() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        Plan plan = new Plan(
                "pln_4",
                "Plan",
                List.of(new Bucket("bkt_uncat", "Uncategorized")),
                List.of());
        repository.savePlan(plan);

        BucketService service = new BucketService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        service.deleteBucket("pln_4", "bkt_uncat");

        Plan updated = repository.findPlanById("pln_4").orElseThrow();
        assertTrue(updated.buckets().isEmpty());
    }

    private Plan planWithUncategorized() {
        return new Plan(
                "pln_1",
                "Plan",
                List.of(
                        new Bucket("bkt_work", "Work"),
                        new Bucket("bkt_side", "Side"),
                        new Bucket("bkt_uncat", "Uncategorized")),
                List.of(
                        task("tsk_1", "bkt_work", Progress.IN_PROGRESS),
                        task("tsk_2", "bkt_work", Progress.NOT_STARTED)));
    }

    private Plan planWithoutUncategorized() {
        return new Plan(
                "pln_2",
                "Plan",
                List.of(new Bucket("bkt_backlog", "Backlog"), new Bucket("bkt_done", "Done")),
                List.of(task("tsk_1", "bkt_backlog", Progress.NOT_STARTED)));
    }

    private Task task(String id, String bucketId, Progress progress) {
        return new Task(
                id,
                "Task " + id,
                bucketId,
                progress,
                Priority.MEDIUM,
                LocalDate.of(2026, 9, 10),
                LocalDate.of(2026, 9, 20),
                null,
                List.of());
    }
}
