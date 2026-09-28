package com.example.kanbanplanner.service.support;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.repository.PlannerRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;

public class InMemoryPlannerRepository implements PlannerRepository {

    private final Map<String, Plan> plans = new LinkedHashMap<>();

    @Override
    public List<PlanSummary> findAllPlans() {
        return plans.values().stream()
                .map(plan -> new PlanSummary(plan.id(), plan.name()))
                .toList();
    }

    @Override
    public Optional<Plan> findPlanById(String planId) {
        return Optional.ofNullable(plans.get(planId));
    }

    @Override
    public Plan savePlan(Plan plan) {
        plans.put(plan.id(), plan);
        return plan;
    }

    @Override
    public void deletePlan(String planId) {
        plans.remove(planId);
    }

    @Override
    public Bucket saveBucket(String planId, Bucket bucket) {
        Plan plan = getPlanOrThrow(planId);
        List<Bucket> buckets = new ArrayList<>(plan.buckets());

        int index = indexOfBucket(buckets, bucket.id());
        if (index < 0) {
            buckets.add(bucket);
        } else {
            buckets.set(index, bucket);
        }

        savePlan(new Plan(plan.id(), plan.name(), buckets, plan.tasks()));
        return bucket;
    }

    @Override
    public void deleteBucket(String planId, String bucketId) {
        Plan plan = getPlanOrThrow(planId);
        List<Bucket> buckets = plan.buckets().stream()
                .filter(bucket -> !bucket.id().equals(bucketId))
                .toList();
        savePlan(new Plan(plan.id(), plan.name(), buckets, plan.tasks()));
    }

    @Override
    public Task saveTask(String planId, Task task) {
        Plan plan = getPlanOrThrow(planId);
        List<Task> tasks = new ArrayList<>(plan.tasks());

        int index = indexOfTask(tasks, task.id());
        if (index < 0) {
            tasks.add(task);
        } else {
            tasks.set(index, task);
        }

        savePlan(new Plan(plan.id(), plan.name(), plan.buckets(), tasks));
        return task;
    }

    @Override
    public void deleteTask(String planId, String taskId) {
        Plan plan = getPlanOrThrow(planId);
        List<Task> tasks = plan.tasks().stream()
                .filter(task -> !task.id().equals(taskId))
                .toList();
        savePlan(new Plan(plan.id(), plan.name(), plan.buckets(), tasks));
    }

    private Plan getPlanOrThrow(String planId) {
        Plan plan = plans.get(planId);
        if (plan == null) {
            throw new NoSuchElementException("Plan not found: " + planId);
        }
        return plan;
    }

    private int indexOfBucket(List<Bucket> buckets, String bucketId) {
        for (int i = 0; i < buckets.size(); i++) {
            if (buckets.get(i).id().equals(bucketId)) {
                return i;
            }
        }
        return -1;
    }

    private int indexOfTask(List<Task> tasks, String taskId) {
        for (int i = 0; i < tasks.size(); i++) {
            if (tasks.get(i).id().equals(taskId)) {
                return i;
            }
        }
        return -1;
    }
}
