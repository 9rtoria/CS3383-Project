package com.example.kanbanplanner.repository;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.domain.Task;
import java.util.List;
import java.util.Optional;

public interface PlannerRepository {

    List<PlanSummary> findAllPlans();

    Optional<Plan> findPlanById(String planId);

    Plan savePlan(Plan plan);

    void deletePlan(String planId);

    Bucket saveBucket(String planId, Bucket bucket);

    void deleteBucket(String planId, String bucketId);

    Task saveTask(String planId, Task task);

    void deleteTask(String planId, String taskId);
}
