package com.example.kanbanplanner.repository.json;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.ChecklistItem;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.domain.Priority;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.domain.Task;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.NoSuchElementException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class JsonPlannerRepositoryTest {

    @TempDir
    Path tempDir;

    @Test
    void saveReadRoundTripPersistsPlanWithNestedData() {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository repository = newRepository(runtimePath);

        Plan original = samplePlan("pln_rt_001", "Round Trip");
        repository.savePlan(original);

        Plan reloaded = repository.findPlanById("pln_rt_001").orElseThrow();
        assertEquals("Round Trip", reloaded.name());
        assertEquals(1, reloaded.buckets().size());
        assertEquals("bkt_rt_001", reloaded.buckets().get(0).id());
        assertEquals(1, reloaded.tasks().size());
        assertEquals("tsk_rt_001", reloaded.tasks().get(0).id());
        assertEquals(1, reloaded.tasks().get(0).checklist().size());
    }

    @Test
    void reinitializeRepositoryReadsPreviouslyWrittenData() {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository firstRepository = newRepository(runtimePath);
        firstRepository.savePlan(samplePlan("pln_restart_001", "Persisted Across Restart"));

        JsonPlannerRepository secondRepository = newRepository(runtimePath);
        PlanSummary savedSummary = secondRepository.findAllPlans().stream()
                .filter(summary -> summary.id().equals("pln_restart_001"))
                .findFirst()
                .orElseThrow();

        assertEquals("Persisted Across Restart", savedSummary.name());
    }

    @Test
    void sequentialUpdatesPreserveUnrelatedFields() {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository repository = newRepository(runtimePath);
        repository.savePlan(samplePlan("pln_seq_001", "Sequence"));

        Bucket renamedBucket = new Bucket("bkt_rt_001", "In Review");
        repository.saveBucket("pln_seq_001", renamedBucket);

        Task updatedTask = new Task(
                "tsk_rt_001",
                "Keep Notes",
                "bkt_rt_001",
                Progress.IN_PROGRESS,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                LocalDate.of(2026, 9, 20),
                "Notes should stay intact",
                List.of(new ChecklistItem("chk_rt_001", "Draft", true)));
        repository.saveTask("pln_seq_001", updatedTask);

        Plan reloaded = repository.findPlanById("pln_seq_001").orElseThrow();
        assertEquals("Sequence", reloaded.name());
        assertEquals("In Review", reloaded.buckets().get(0).name());
        assertEquals("Keep Notes", reloaded.tasks().get(0).title());
        assertEquals("Notes should stay intact", reloaded.tasks().get(0).notes());
    }

    @Test
    void runtimeFileMissingInitializesFromSeedData() {
        Path runtimePath = tempDir.resolve("nested").resolve("planner-data.json");
        assertFalse(Files.exists(runtimePath));

        JsonPlannerRepository repository = newRepository(runtimePath);
        List<PlanSummary> plans = repository.findAllPlans();

        assertTrue(Files.exists(runtimePath));
        assertFalse(plans.isEmpty());
        assertNotNull(plans.get(0).id());
    }

    @Test
    void atomicWriteFailureDoesNotCorruptExistingRuntimeFile() throws IOException {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository repository = newRepository(runtimePath);
        repository.savePlan(samplePlan("pln_atomic_001", "Atomic Source"));

        String before = Files.readString(runtimePath);

        JsonPlannerRepository failingRepository = new JsonPlannerRepository(runtimePath, objectMapper()) {
            @Override
            protected void replaceFile(Path source, Path target) throws IOException {
                throw new IOException("Simulated replace failure");
            }
        };

        assertThrows(IllegalStateException.class,
                () -> failingRepository.savePlan(samplePlan("pln_atomic_002", "Should Fail")));

        String after = Files.readString(runtimePath);
        assertEquals(before, after);
        assertTrue(repository.findPlanById("pln_atomic_001").isPresent());
        assertTrue(repository.findPlanById("pln_atomic_002").isEmpty());
    }

    @Test
    void transientAccessDeniedDuringReplaceRetriesAndEventuallySucceeds() {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository repository = newRepository(runtimePath);
        repository.savePlan(samplePlan("pln_retry_seed", "Retry Seed"));

        JsonPlannerRepository retryingRepository = new JsonPlannerRepository(runtimePath, objectMapper()) {
            private int replaceAttempts = 0;

            @Override
            protected void replaceFile(Path source, Path target) throws IOException {
                replaceAttempts++;
                if (replaceAttempts <= 2) {
                    throw new AccessDeniedException(source.toString(), target.toString(), "Simulated transient lock");
                }
                super.replaceFile(source, target);
            }
        };

        retryingRepository.savePlan(samplePlan("pln_retry_001", "Retry Success"));

        JsonPlannerRepository reloaded = newRepository(runtimePath);
        assertTrue(reloaded.findPlanById("pln_retry_seed").isPresent());
        assertTrue(reloaded.findPlanById("pln_retry_001").isPresent());
    }

    @Test
    void deleteOperationsPersistAcrossRestart() {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository repository = newRepository(runtimePath);

        repository.savePlan(samplePlan("pln_delete_001", "Delete Sequence"));
        repository.deleteTask("pln_delete_001", "tsk_rt_001");
        repository.deleteBucket("pln_delete_001", "bkt_rt_001");

        JsonPlannerRepository restartedAfterChildDeletes = newRepository(runtimePath);
        Plan reloaded = restartedAfterChildDeletes.findPlanById("pln_delete_001").orElseThrow();
        assertTrue(reloaded.tasks().isEmpty());
        assertTrue(reloaded.buckets().isEmpty());

        restartedAfterChildDeletes.deletePlan("pln_delete_001");

        JsonPlannerRepository restartedAfterPlanDelete = newRepository(runtimePath);
        assertTrue(restartedAfterPlanDelete.findPlanById("pln_delete_001").isEmpty());
    }

    @Test
    void bucketAndTaskOperationsFailWhenPlanIsMissing() {
        Path runtimePath = tempDir.resolve("planner-data.json");
        JsonPlannerRepository repository = newRepository(runtimePath);

        assertThrows(NoSuchElementException.class,
                () -> repository.saveBucket("missing-plan", new Bucket("bkt_1", "Backlog")));
        assertThrows(NoSuchElementException.class,
                () -> repository.saveTask("missing-plan", sampleTask("tsk_1", "bkt_1")));
        assertThrows(NoSuchElementException.class,
                () -> repository.deleteBucket("missing-plan", "bkt_1"));
        assertThrows(NoSuchElementException.class,
                () -> repository.deleteTask("missing-plan", "tsk_1"));
    }

    private JsonPlannerRepository newRepository(Path runtimePath) {
        return new JsonPlannerRepository(runtimePath, objectMapper());
    }

    private ObjectMapper objectMapper() {
        return new ObjectMapper().findAndRegisterModules();
    }

    private Plan samplePlan(String id, String name) {
        Bucket bucket = new Bucket("bkt_rt_001", "To Do");
        Task task = sampleTask("tsk_rt_001", bucket.id());
        return new Plan(id, name, List.of(bucket), List.of(task));
    }

    private Task sampleTask(String taskId, String bucketId) {
        return new Task(
                taskId,
                "Draft milestone tests",
                bucketId,
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                LocalDate.of(2026, 9, 10),
                LocalDate.of(2026, 9, 20),
                "Test notes",
                List.of(new ChecklistItem("chk_rt_001", "Draft", false)));
    }
}
