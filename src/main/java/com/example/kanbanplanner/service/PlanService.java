package com.example.kanbanplanner.service;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.repository.PlannerRepository;
import com.example.kanbanplanner.validation.ValidationDetail;
import com.example.kanbanplanner.validation.ValidationException;
import com.example.kanbanplanner.validation.PlannerValidator;
import java.util.ArrayList;
import java.util.EnumSet;
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
        Plan updated = new Plan(existing.id(), name, existing.buckets(), existing.tasks(), existing.progressOrder());
        return plannerRepository.savePlan(updated);
    }

    public List<Progress> reorderProgressOrder(String planId, List<String> progressOrderLabels) {
        Plan existing = findPlanRequired(planId);
        List<Progress> reordered = validateAndMapProgressOrder(progressOrderLabels);
        Plan updated = new Plan(
                existing.id(),
                existing.name(),
                existing.buckets(),
                existing.tasks(),
                reordered);
        plannerRepository.savePlan(updated);
        return reordered;
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

    private List<Progress> validateAndMapProgressOrder(List<String> progressOrderLabels) {
        List<Progress> defaultOrder = Progress.defaultOrder();
        if (progressOrderLabels == null || progressOrderLabels.size() != defaultOrder.size()) {
            throw ValidationErrors.invalidProgressOrder();
        }

        EnumSet<Progress> seen = EnumSet.noneOf(Progress.class);
        List<Progress> ordered = new ArrayList<>();
        for (String label : progressOrderLabels) {
            if (label == null || label.trim().isEmpty()) {
                throw ValidationErrors.invalidProgressOrder();
            }

            Progress parsed;
            try {
                parsed = validator.parseProgressLabel(label.trim());
            } catch (ValidationException exception) {
                throw ValidationErrors.invalidProgressOrder();
            }

            if (!seen.add(parsed)) {
                throw ValidationErrors.invalidProgressOrder();
            }
            ordered.add(parsed);
        }

        if (seen.size() != defaultOrder.size()) {
            throw ValidationErrors.invalidProgressOrder();
        }

        return List.copyOf(ordered);
    }

    private static final class ValidationErrors {
        private ValidationErrors() {
        }

        private static ValidationException invalidProgressOrder() {
            return new ValidationException(
                    "Validation failed",
                    List.of(new ValidationDetail(
                            "progressOrder",
                            "must be a permutation of: Not started, In progress, Completed")));
        }
    }
}
