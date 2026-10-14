package com.example.kanbanplanner.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.service.support.InMemoryPlannerRepository;
import com.example.kanbanplanner.validation.PlannerValidator;
import com.example.kanbanplanner.validation.ValidationException;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlanServiceTest {

    @Test
    void createPlanAddsDefaultBucketsAndTrimsName() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        PlanService service = new PlanService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(
                        List.of("pln_100"),
                        List.of("bkt_1", "bkt_2", "bkt_3"),
                        List.of(),
                        List.of()));

        Plan created = service.createPlan("  Semester Tasks  ");

        assertEquals("pln_100", created.id());
        assertEquals("Semester Tasks", created.name());
        assertEquals(3, created.buckets().size());
        assertEquals("To Do", created.buckets().get(0).name());
        assertEquals("Doing", created.buckets().get(1).name());
        assertEquals("Done", created.buckets().get(2).name());
    }

    @Test
    void createPlanRejectsInvalidNameBoundary() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        PlanService service = new PlanService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(
                        List.of("pln_100"),
                        List.of("bkt_1", "bkt_2", "bkt_3"),
                        List.of(),
                        List.of()));

        ValidationException exception = assertThrows(
                ValidationException.class,
                () -> service.createPlan(repeat("x", 61)));

        assertEquals("name", exception.details().get(0).field());
    }

    @Test
    void deletePlanRemovesPlanAndNestedDataFromRepository() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan(
                "pln_1",
                "Plan",
                List.of(new Bucket("bkt_1", "To Do")),
                List.of()));

        PlanService service = new PlanService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        service.deletePlan("pln_1");

        assertTrue(repository.findPlanById("pln_1").isEmpty());
    }

    @Test
    void renamePlanRejectsBlankName() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan("pln_1", "Original", List.of(), List.of()));

        PlanService service = new PlanService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        ValidationException exception = assertThrows(
                ValidationException.class,
                () -> service.renamePlan("pln_1", "   "));

        assertEquals("name", exception.details().get(0).field());
    }

    @Test
    void reorderProgressOrderPersistsForPlan() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan("pln_1", "Original", List.of(), List.of()));

        PlanService service = new PlanService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        List<Progress> reordered = service.reorderProgressOrder(
                "pln_1",
                List.of("Completed", "Not started", "In progress"));

        assertEquals(List.of(Progress.COMPLETED, Progress.NOT_STARTED, Progress.IN_PROGRESS), reordered);
        Plan reloaded = repository.findPlanById("pln_1").orElseThrow();
        assertEquals(List.of(Progress.COMPLETED, Progress.NOT_STARTED, Progress.IN_PROGRESS), reloaded.progressOrder());
    }

    @Test
    void reorderProgressOrderRejectsInvalidPermutation() {
        InMemoryPlannerRepository repository = new InMemoryPlannerRepository();
        repository.savePlan(new Plan("pln_1", "Original", List.of(), List.of()));

        PlanService service = new PlanService(
                repository,
                new PlannerValidator(),
                new TestIdGenerator(List.of(), List.of(), List.of(), List.of()));

        ValidationException duplicate = assertThrows(
                ValidationException.class,
                () -> service.reorderProgressOrder("pln_1", List.of("Completed", "Completed", "Not started")));
        assertEquals("progressOrder", duplicate.details().get(0).field());

        ValidationException missing = assertThrows(
                ValidationException.class,
                () -> service.reorderProgressOrder("pln_1", List.of("Completed", "Not started")));
        assertEquals("progressOrder", missing.details().get(0).field());

        ValidationException unknown = assertThrows(
                ValidationException.class,
                () -> service.reorderProgressOrder("pln_1", List.of("Completed", "Not started", "Blocked")));
        assertEquals("progressOrder", unknown.details().get(0).field());
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < count; i++) {
            builder.append(value);
        }
        return builder.toString();
    }
}
