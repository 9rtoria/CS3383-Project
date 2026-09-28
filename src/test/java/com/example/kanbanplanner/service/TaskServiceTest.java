package com.example.kanbanplanner.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.ChecklistItem;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Priority;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.service.TaskService.ChecklistItemInput;
import com.example.kanbanplanner.service.TaskService.TaskInput;
import com.example.kanbanplanner.service.support.InMemoryPlannerRepository;
import com.example.kanbanplanner.validation.PlannerValidator;
import com.example.kanbanplanner.validation.ValidationException;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class TaskServiceTest {

    @Test
    void createTaskValidatesTitleBoundariesAndBucketExistence() {
        InMemoryPlannerRepository repository = seededRepository();
        TaskService service = new TaskService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of("tsk_new"), List.of("chk_new")));

        assertValidation("title", () -> service.createTask("pln_1", inputWithTitle("")));
        assertValidation("title", () -> service.createTask("pln_1", inputWithTitle(repeat("x", 121))));
        assertValidation("bucketId", () -> service.createTask("pln_1", inputWithBucket("missing")));
    }

    @Test
    void createTaskValidatesChecklistBoundariesAndEnumsRequired() {
        InMemoryPlannerRepository repository = seededRepository();
        TaskService service = new TaskService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of("tsk_new"), List.of("chk_new")));

        TaskInput checklistTooLong = new TaskInput(
                "Task",
                "bkt_1",
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                null,
                null,
                null,
                List.of(new ChecklistItemInput(null, repeat("c", 121), false)));
        assertValidation("checklist.text", () -> service.createTask("pln_1", checklistTooLong));

        TaskInput nullProgress = new TaskInput(
                "Task",
                "bkt_1",
                null,
                Priority.MEDIUM,
                null,
                null,
                null,
                List.of());
        assertValidation("progress", () -> service.createTask("pln_1", nullProgress));

        TaskInput nullPriority = new TaskInput(
                "Task",
                "bkt_1",
                Progress.NOT_STARTED,
                null,
                null,
                null,
                null,
                List.of());
        assertValidation("priority", () -> service.createTask("pln_1", nullPriority));
    }

    @Test
    void createTaskValidatesDateConsistencyBoundaries() {
        InMemoryPlannerRepository repository = seededRepository();
        TaskService service = new TaskService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of("tsk_new"), List.of("chk_new")));

        TaskInput sameDay = new TaskInput(
                "Task",
                "bkt_1",
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                LocalDate.of(2026, 9, 28),
                LocalDate.of(2026, 9, 28),
                null,
                List.of());
        Task created = service.createTask("pln_1", sameDay);
        assertEquals(LocalDate.of(2026, 9, 28), created.startDate());

        TaskInput invalidRange = new TaskInput(
                "Task",
                "bkt_1",
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                LocalDate.of(2026, 9, 29),
                LocalDate.of(2026, 9, 28),
                null,
                List.of());
        assertValidation("dueDate", () -> service.createTask("pln_1", invalidRange));
    }

    @Test
    void updateTaskChecklistCompletionDoesNotChangeProgress() {
        InMemoryPlannerRepository repository = seededRepositoryWithTask();
        TaskService service = new TaskService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of("chk_existing")));

        TaskInput update = new TaskInput(
                "Existing task",
                "bkt_1",
                Progress.IN_PROGRESS,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                LocalDate.of(2026, 9, 20),
                "notes",
                List.of(new ChecklistItemInput("chk_1", "Item", true)));

        Task updated = service.updateTask("pln_2", "tsk_1", update);

        assertEquals(Progress.IN_PROGRESS, updated.progress());
        assertTrue(updated.checklist().get(0).completed());
    }

    @Test
    void isTaskOverdueMatchesRequiredMatrix() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        LocalDate today = LocalDate.of(2026, 9, 15);

        Plan plan = new Plan(
                "pln_overdue",
                "Plan",
                List.of(new Bucket("bkt_1", "To Do")),
                List.of(
                        task("tsk_no_due", "bkt_1", Progress.IN_PROGRESS, null),
                        task("tsk_today", "bkt_1", Progress.IN_PROGRESS, today),
                        task("tsk_yesterday_active", "bkt_1", Progress.IN_PROGRESS, today.minusDays(1)),
                        task("tsk_yesterday_done", "bkt_1", Progress.COMPLETED, today.minusDays(1))));
        repository.savePlan(plan);

        TaskService service = new TaskService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        assertFalse(service.isTaskOverdue("pln_overdue", "tsk_no_due", today));
        assertFalse(service.isTaskOverdue("pln_overdue", "tsk_today", today));
        assertTrue(service.isTaskOverdue("pln_overdue", "tsk_yesterday_active", today));
        assertFalse(service.isTaskOverdue("pln_overdue", "tsk_yesterday_done", today));
    }

    @Test
    void deleteTaskRemovesOnlyTargetTask() {
        InMemoryPlannerRepository repository = seededRepositoryWithTask();
        Plan existing = repository.findPlanById("pln_2").orElseThrow();
        repository.savePlan(new Plan(
                existing.id(),
                existing.name(),
                existing.buckets(),
                List.of(
                        existing.tasks().get(0),
                        task("tsk_2", "bkt_1", Progress.NOT_STARTED, LocalDate.of(2026, 10, 1)))));

        TaskService service = new TaskService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        service.deleteTask("pln_2", "tsk_1");

        Plan updated = repository.findPlanById("pln_2").orElseThrow();
        assertEquals(1, updated.tasks().size());
        assertEquals("tsk_2", updated.tasks().get(0).id());
    }

    private InMemoryPlannerRepository seededRepository() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan(
                "pln_1",
                "Plan",
                List.of(new Bucket("bkt_1", "To Do")),
                List.of()));
        return repository;
    }

    private InMemoryPlannerRepository seededRepositoryWithTask() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan(
                "pln_2",
                "Plan",
                List.of(new Bucket("bkt_1", "To Do")),
                List.of(task("tsk_1", "bkt_1", Progress.IN_PROGRESS, LocalDate.of(2026, 9, 20)))));
        return repository;
    }

    private TaskInput inputWithTitle(String title) {
        return new TaskInput(
                title,
                "bkt_1",
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                null,
                null,
                null,
                List.of(new ChecklistItemInput(null, "Item", false)));
    }

    private TaskInput inputWithBucket(String bucketId) {
        return new TaskInput(
                "Valid",
                bucketId,
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                null,
                null,
                null,
                List.of(new ChecklistItemInput(null, "Item", false)));
    }

    private Task task(String id, String bucketId, Progress progress, LocalDate dueDate) {
        return new Task(
                id,
                "Existing task",
                bucketId,
                progress,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                dueDate,
                "notes",
                List.of(new ChecklistItem("chk_1", "Item", false)));
    }

    private void assertValidation(String field, Runnable call) {
        ValidationException exception = assertThrows(ValidationException.class, call::run);
        assertEquals(field, exception.details().get(0).field());
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < count; i++) {
            builder.append(value);
        }
        return builder.toString();
    }
}
