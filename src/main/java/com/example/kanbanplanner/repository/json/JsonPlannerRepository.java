package com.example.kanbanplanner.repository.json;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.repository.PlannerRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AccessDeniedException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

@Repository
public class JsonPlannerRepository implements PlannerRepository {

    private static final String DEFAULT_RUNTIME_PATH = "./data/planner-data.json";
    private static final String SEED_RESOURCE_PATH = "data/seed-data.json";
    private static final int REPLACE_RETRY_ATTEMPTS = 6;
    private static final long REPLACE_RETRY_DELAY_MILLIS = 30L;

    private final ObjectMapper objectMapper;
    private final Path runtimeDataPath;

    @Autowired
    public JsonPlannerRepository(
            @Value("${planner.storage.runtime-path:" + DEFAULT_RUNTIME_PATH + "}") String runtimePath,
            ObjectMapper objectMapper
    ) {
        this(Path.of(runtimePath), objectMapper);
    }

    JsonPlannerRepository(Path runtimeDataPath, ObjectMapper objectMapper) {
        this.runtimeDataPath = runtimeDataPath;
        this.objectMapper = objectMapper;
    }

    @Override
    public synchronized List<PlanSummary> findAllPlans() {
        StorageDocument document = readRuntimeDocument();
        return document.plans().stream()
                .map(plan -> new PlanSummary(plan.id(), plan.name()))
                .toList();
    }

    @Override
    public synchronized Optional<Plan> findPlanById(String planId) {
        StorageDocument document = readRuntimeDocument();
        return document.plans().stream()
                .filter(plan -> plan.id().equals(planId))
                .findFirst();
    }

    @Override
    public synchronized Plan savePlan(Plan plan) {
        StorageDocument document = readRuntimeDocument();
        List<Plan> updatedPlans = replaceOrAppendPlan(document.plans(), plan);
        writeRuntimeDocument(new StorageDocument(updatedPlans));
        return plan;
    }

    @Override
    public synchronized void deletePlan(String planId) {
        StorageDocument document = readRuntimeDocument();
        List<Plan> updatedPlans = document.plans().stream()
                .filter(plan -> !plan.id().equals(planId))
                .toList();
        writeRuntimeDocument(new StorageDocument(updatedPlans));
    }

    @Override
    public synchronized Bucket saveBucket(String planId, Bucket bucket) {
        StorageDocument document = readRuntimeDocument();
        Plan targetPlan = findPlanRequired(document.plans(), planId);

        List<Bucket> updatedBuckets = replaceOrAppendBucket(targetPlan.buckets(), bucket);
        Plan updatedPlan = new Plan(targetPlan.id(), targetPlan.name(), updatedBuckets, targetPlan.tasks());

        List<Plan> updatedPlans = replacePlan(document.plans(), updatedPlan);
        writeRuntimeDocument(new StorageDocument(updatedPlans));
        return bucket;
    }

    @Override
    public synchronized void deleteBucket(String planId, String bucketId) {
        StorageDocument document = readRuntimeDocument();
        Plan targetPlan = findPlanRequired(document.plans(), planId);

        List<Bucket> updatedBuckets = targetPlan.buckets().stream()
                .filter(bucket -> !bucket.id().equals(bucketId))
                .toList();
        Plan updatedPlan = new Plan(targetPlan.id(), targetPlan.name(), updatedBuckets, targetPlan.tasks());

        List<Plan> updatedPlans = replacePlan(document.plans(), updatedPlan);
        writeRuntimeDocument(new StorageDocument(updatedPlans));
    }

    @Override
    public synchronized Task saveTask(String planId, Task task) {
        StorageDocument document = readRuntimeDocument();
        Plan targetPlan = findPlanRequired(document.plans(), planId);

        List<Task> updatedTasks = replaceOrAppendTask(targetPlan.tasks(), task);
        Plan updatedPlan = new Plan(targetPlan.id(), targetPlan.name(), targetPlan.buckets(), updatedTasks);

        List<Plan> updatedPlans = replacePlan(document.plans(), updatedPlan);
        writeRuntimeDocument(new StorageDocument(updatedPlans));
        return task;
    }

    @Override
    public synchronized void deleteTask(String planId, String taskId) {
        StorageDocument document = readRuntimeDocument();
        Plan targetPlan = findPlanRequired(document.plans(), planId);

        List<Task> updatedTasks = targetPlan.tasks().stream()
                .filter(task -> !task.id().equals(taskId))
                .toList();
        Plan updatedPlan = new Plan(targetPlan.id(), targetPlan.name(), targetPlan.buckets(), updatedTasks);

        List<Plan> updatedPlans = replacePlan(document.plans(), updatedPlan);
        writeRuntimeDocument(new StorageDocument(updatedPlans));
    }

    private StorageDocument readRuntimeDocument() {
        ensureRuntimeDataExists();

        try {
            return objectMapper.readValue(runtimeDataPath.toFile(), StorageDocument.class);
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to read runtime data from: " + runtimeDataPath, exception);
        }
    }

    private void ensureRuntimeDataExists() {
        if (Files.exists(runtimeDataPath)) {
            return;
        }

        try {
            Path parent = runtimeDataPath.toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to create runtime data directory for: " + runtimeDataPath, exception);
        }

        StorageDocument seedDocument = readSeedDocument();
        writeRuntimeDocument(seedDocument);
    }

    private StorageDocument readSeedDocument() {
        try (InputStream inputStream = Thread.currentThread()
                .getContextClassLoader()
                .getResourceAsStream(SEED_RESOURCE_PATH)) {
            if (inputStream == null) {
                throw new IllegalStateException("Seed data resource not found: " + SEED_RESOURCE_PATH);
            }
            return objectMapper.readValue(inputStream, StorageDocument.class);
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to read seed data resource: " + SEED_RESOURCE_PATH, exception);
        }
    }

    private void writeRuntimeDocument(StorageDocument document) {
        try {
            Path parent = runtimeDataPath.toAbsolutePath().getParent();
            if (parent == null) {
                parent = runtimeDataPath.toAbsolutePath().getRoot();
            }
            if (parent == null) {
                throw new IllegalStateException("Cannot resolve parent directory for: " + runtimeDataPath);
            }
            if (parent != null) {
                Files.createDirectories(parent);
            }

            Path tempFile = Files.createTempFile(parent, "planner-data-", ".tmp");
            try {
                objectMapper.writerWithDefaultPrettyPrinter().writeValue(tempFile.toFile(), document);
                replaceFileWithRetry(tempFile, runtimeDataPath);
            } finally {
                Files.deleteIfExists(tempFile);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to write runtime data to: " + runtimeDataPath, exception);
        }
    }

    private void replaceFileWithRetry(Path source, Path target) throws IOException {
        AccessDeniedException lastAccessDenied = null;

        for (int attempt = 1; attempt <= REPLACE_RETRY_ATTEMPTS; attempt++) {
            try {
                replaceFile(source, target);
                return;
            } catch (AccessDeniedException exception) {
                lastAccessDenied = exception;
                if (attempt == REPLACE_RETRY_ATTEMPTS) {
                    throw exception;
                }
                sleepBeforeRetry(lastAccessDenied, attempt);
            }
        }

        if (lastAccessDenied != null) {
            throw lastAccessDenied;
        }
    }

    private void sleepBeforeRetry(AccessDeniedException failure, int attempt) throws IOException {
        try {
            Thread.sleep(REPLACE_RETRY_DELAY_MILLIS * attempt);
        } catch (InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
            IOException wrapped = new IOException("Interrupted while retrying runtime data file replace", interruptedException);
            wrapped.addSuppressed(failure);
            throw wrapped;
        }
    }

    protected void replaceFile(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static Plan findPlanRequired(List<Plan> plans, String planId) {
        return plans.stream()
                .filter(plan -> plan.id().equals(planId))
                .findFirst()
                .orElseThrow(() -> new NoSuchElementException("Plan not found: " + planId));
    }

    private static List<Plan> replaceOrAppendPlan(List<Plan> source, Plan replacement) {
        int index = indexOfPlan(source, replacement.id());
        if (index < 0) {
            List<Plan> appended = new ArrayList<>(source);
            appended.add(replacement);
            return List.copyOf(appended);
        }
        return replaceByIndex(source, index, replacement);
    }

    private static List<Plan> replacePlan(List<Plan> source, Plan replacement) {
        int index = indexOfPlan(source, replacement.id());
        if (index < 0) {
            throw new NoSuchElementException("Plan not found: " + replacement.id());
        }
        return replaceByIndex(source, index, replacement);
    }

    private static List<Bucket> replaceOrAppendBucket(List<Bucket> source, Bucket replacement) {
        int index = indexOfBucket(source, replacement.id());
        if (index < 0) {
            List<Bucket> appended = new ArrayList<>(source);
            appended.add(replacement);
            return List.copyOf(appended);
        }
        List<Bucket> updated = new ArrayList<>(source);
        updated.set(index, replacement);
        return List.copyOf(updated);
    }

    private static List<Task> replaceOrAppendTask(List<Task> source, Task replacement) {
        int index = indexOfTask(source, replacement.id());
        if (index < 0) {
            List<Task> appended = new ArrayList<>(source);
            appended.add(replacement);
            return List.copyOf(appended);
        }
        List<Task> updated = new ArrayList<>(source);
        updated.set(index, replacement);
        return List.copyOf(updated);
    }

    private static List<Plan> replaceByIndex(List<Plan> source, int index, Plan replacement) {
        List<Plan> updated = new ArrayList<>(source);
        updated.set(index, replacement);
        return List.copyOf(updated);
    }

    private static int indexOfPlan(List<Plan> plans, String planId) {
        for (int i = 0; i < plans.size(); i++) {
            if (plans.get(i).id().equals(planId)) {
                return i;
            }
        }
        return -1;
    }

    private static int indexOfBucket(List<Bucket> buckets, String bucketId) {
        for (int i = 0; i < buckets.size(); i++) {
            if (buckets.get(i).id().equals(bucketId)) {
                return i;
            }
        }
        return -1;
    }

    private static int indexOfTask(List<Task> tasks, String taskId) {
        for (int i = 0; i < tasks.size(); i++) {
            if (tasks.get(i).id().equals(taskId)) {
                return i;
            }
        }
        return -1;
    }
}
