package com.example.kanbanplanner.service;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.repository.PlannerRepository;
import com.example.kanbanplanner.validation.PlannerValidator;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class PlanService {

    private static final List<String> DEFAULT_BUCKET_NAMES = List.of("To Do", "Doing", "Done");

    private final PlannerRepository plannerRepository;
    private final PlannerValidator validator;
    private final IdGenerator idGenerator;

    public PlanService(PlannerRepository plannerRepository, PlannerValidator validator, IdGenerator idGenerator) {
        this.plannerRepository = plannerRepository;
        this.validator = validator;
        this.idGenerator = idGenerator;
    }

    public List<PlanSummary> listPlans() {
        return plannerRepository.findAllPlans();
    }

    public Plan getPlan(String planId) {
        return findPlanRequired(planId);
    }

    public Plan createPlan(String rawName) {
        String name = validator.validatePlanName(rawName);
        List<Bucket> buckets = createDefaultBuckets();
        Plan plan = new Plan(idGenerator.nextPlanId(), name, buckets, List.of());
        return plannerRepository.savePlan(plan);
    }

    public Plan renamePlan(String planId, String rawName) {
        Plan existing = findPlanRequired(planId);
        String name = validator.validatePlanName(rawName);
        Plan updated = new Plan(existing.id(), name, existing.buckets(), existing.tasks());
        return plannerRepository.savePlan(updated);
    }

    public void deletePlan(String planId) {
        Plan existing = findPlanRequired(planId);
        plannerRepository.deletePlan(existing.id());
    }

    private Plan findPlanRequired(String planId) {
        return plannerRepository.findPlanById(planId)
                .orElseThrow(() -> new NotFoundException("Plan not found: " + planId));
    }

    private List<Bucket> createDefaultBuckets() {
        List<Bucket> buckets = new ArrayList<>();
        for (String bucketName : DEFAULT_BUCKET_NAMES) {
            buckets.add(new Bucket(idGenerator.nextBucketId(), bucketName));
        }
        return List.copyOf(buckets);
    }
}
