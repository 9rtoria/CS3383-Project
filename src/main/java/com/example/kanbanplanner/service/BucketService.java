package com.example.kanbanplanner.service;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.repository.PlannerRepository;
import com.example.kanbanplanner.validation.PlannerValidator;
import com.example.kanbanplanner.validation.ValidationDetail;
import com.example.kanbanplanner.validation.ValidationException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class BucketService {

    private static final String UNCATEGORIZED_NAME = "Uncategorized";

    private final PlannerRepository plannerRepository;
    private final PlannerValidator validator;
    private final IdGenerator idGenerator;

    public BucketService(PlannerRepository plannerRepository, PlannerValidator validator, IdGenerator idGenerator) {
        this.plannerRepository = plannerRepository;
        this.validator = validator;
        this.idGenerator = idGenerator;
    }

    public Bucket createBucket(String planId, String rawBucketName) {
        Plan plan = findPlanRequired(planId);
        String bucketName = validator.validateBucketName(rawBucketName);
        validator.validateBucketNameUnique(plan, bucketName, null);

        Bucket bucket = new Bucket(idGenerator.nextBucketId(), bucketName);
        List<Bucket> updatedBuckets = new ArrayList<>(plan.buckets());
        updatedBuckets.add(bucket);

        Plan updatedPlan = new Plan(plan.id(), plan.name(), updatedBuckets, plan.tasks());
        plannerRepository.savePlan(updatedPlan);
        return bucket;
    }

    public Bucket renameBucket(String planId, String bucketId, String rawBucketName) {
        Plan plan = findPlanRequired(planId);
        Bucket existing = findBucketRequired(plan, bucketId);

        String bucketName = validator.validateBucketName(rawBucketName);
        validator.validateBucketNameUnique(plan, bucketName, bucketId);

        Bucket renamed = new Bucket(existing.id(), bucketName);
        List<Bucket> updatedBuckets = plan.buckets().stream()
                .map(bucket -> bucket.id().equals(bucketId) ? renamed : bucket)
                .toList();

        Plan updatedPlan = new Plan(plan.id(), plan.name(), updatedBuckets, plan.tasks());
        plannerRepository.savePlan(updatedPlan);
        return renamed;
    }

    public void deleteBucket(String planId, String bucketId) {
        Plan plan = findPlanRequired(planId);
        Bucket target = findBucketRequired(plan, bucketId);

        List<Task> tasksInBucket = plan.tasks().stream()
                .filter(task -> task.bucketId().equals(target.id()))
                .toList();

        if (isUncategorized(target) && !tasksInBucket.isEmpty()) {
            throw ValidationErrors.deleteNonEmptyUncategorized();
        }

        if (tasksInBucket.isEmpty()) {
            deleteBucketOnly(plan, target.id());
            return;
        }

        Bucket uncategorized = findUncategorizedBucket(plan);
        Plan planWithUncategorized = plan;
        if (uncategorized == null) {
            uncategorized = new Bucket(idGenerator.nextBucketId(), UNCATEGORIZED_NAME);
            List<Bucket> expandedBuckets = new ArrayList<>(plan.buckets());
            expandedBuckets.add(uncategorized);
            planWithUncategorized = new Plan(plan.id(), plan.name(), expandedBuckets, plan.tasks());
        }

        String fallbackBucketId = uncategorized.id();
        List<Task> updatedTasks = planWithUncategorized.tasks().stream()
                .map(task -> task.bucketId().equals(target.id())
                        ? new Task(
                                task.id(),
                                task.title(),
                                fallbackBucketId,
                                task.progress(),
                                task.priority(),
                                task.startDate(),
                                task.dueDate(),
                                task.notes(),
                                task.checklist())
                        : task)
                .toList();

        List<Bucket> finalBuckets = planWithUncategorized.buckets().stream()
                .filter(bucket -> !bucket.id().equals(target.id()))
                .toList();

        Plan updatedPlan = new Plan(plan.id(), plan.name(), finalBuckets, updatedTasks);
        plannerRepository.savePlan(updatedPlan);
    }

    private void deleteBucketOnly(Plan plan, String bucketId) {
        List<Bucket> updatedBuckets = plan.buckets().stream()
                .filter(bucket -> !bucket.id().equals(bucketId))
                .toList();
        Plan updatedPlan = new Plan(plan.id(), plan.name(), updatedBuckets, plan.tasks());
        plannerRepository.savePlan(updatedPlan);
    }

    private Bucket findBucketRequired(Plan plan, String bucketId) {
        return plan.buckets().stream()
                .filter(bucket -> bucket.id().equals(bucketId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Bucket not found: " + bucketId));
    }

    private Bucket findUncategorizedBucket(Plan plan) {
        return plan.buckets().stream()
                .filter(this::isUncategorized)
                .findFirst()
                .orElse(null);
    }

    private boolean isUncategorized(Bucket bucket) {
        return UNCATEGORIZED_NAME.equals(bucket.name());
    }

    private Plan findPlanRequired(String planId) {
        return plannerRepository.findPlanById(planId)
                .orElseThrow(() -> new NotFoundException("Plan not found: " + planId));
    }

    private static final class ValidationErrors {
        private ValidationErrors() {
        }

        private static ValidationException deleteNonEmptyUncategorized() {
            return new ValidationException(
                    "Validation failed",
                    List.of(new ValidationDetail(
                            "bucket",
                            "Cannot delete non-empty Uncategorized bucket")));
        }
    }
}
