package com.example.kanbanplanner.validation;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Priority;
import com.example.kanbanplanner.domain.Progress;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class PlannerValidator {

    public static final int PLAN_NAME_MAX_LENGTH = 60;
    public static final int BUCKET_NAME_MAX_LENGTH = 60;
    public static final int TASK_TITLE_MAX_LENGTH = 120;
    public static final int CHECKLIST_ITEM_TEXT_MAX_LENGTH = 120;

    public String validatePlanName(String rawName) {
        return validateTrimmedLength("name", rawName, PLAN_NAME_MAX_LENGTH);
    }

    public String validateBucketName(String rawName) {
        return validateTrimmedLength("name", rawName, BUCKET_NAME_MAX_LENGTH);
    }

    public String validateTaskTitle(String rawTitle) {
        return validateTrimmedLength("title", rawTitle, TASK_TITLE_MAX_LENGTH);
    }

    public String validateChecklistItemText(String rawText) {
        return validateTrimmedLength("checklist.text", rawText, CHECKLIST_ITEM_TEXT_MAX_LENGTH);
    }

    public String validateRequiredBucketId(String rawBucketId) {
        String bucketId = rawBucketId == null ? "" : rawBucketId.trim();
        if (bucketId.isEmpty()) {
            throw ValidationErrors.single("bucketId", "is required");
        }
        return bucketId;
    }

    public Progress requireProgress(Progress progress) {
        if (progress == null) {
            throw ValidationErrors.single("progress", "is required");
        }
        return progress;
    }

    public Priority requirePriority(Priority priority) {
        if (priority == null) {
            throw ValidationErrors.single("priority", "is required");
        }
        return priority;
    }

    public Progress parseProgressLabel(String label) {
        try {
            return Progress.fromLabel(label);
        } catch (RuntimeException exception) {
            throw ValidationErrors.single("progress", "must be one of: Not started, In progress, Completed");
        }
    }

    public Priority parsePriorityLabel(String label) {
        try {
            return Priority.fromLabel(label);
        } catch (RuntimeException exception) {
            throw ValidationErrors.single("priority", "must be one of: Urgent, Important, Medium, Low");
        }
    }

    public void validateDateConsistency(LocalDate startDate, LocalDate dueDate) {
        if (startDate != null && dueDate != null && startDate.isAfter(dueDate)) {
            throw ValidationErrors.single("dueDate", "must be on or after startDate");
        }
    }

    public void validateBucketNameUnique(Plan plan, String bucketName, String excludedBucketId) {
        for (Bucket bucket : plan.buckets()) {
            if (excludedBucketId != null && bucket.id().equals(excludedBucketId)) {
                continue;
            }
            if (bucket.name() != null && bucket.name().trim().equalsIgnoreCase(bucketName)) {
                throw ValidationErrors.single("name", "must be unique within the plan");
            }
        }
    }

    public void requireBucketExists(Plan plan, String bucketId) {
        boolean exists = plan.buckets().stream().anyMatch(bucket -> bucket.id().equals(bucketId));
        if (!exists) {
            throw ValidationErrors.single("bucketId", "must reference an existing bucket in the plan");
        }
    }

    private String validateTrimmedLength(String field, String rawValue, int maxLength) {
        String value = rawValue == null ? "" : rawValue.trim();
        if (value.isEmpty()) {
            throw ValidationErrors.single(field, "is required");
        }
        if (value.length() > maxLength) {
            throw ValidationErrors.single(field, "must be between 1 and " + maxLength + " characters");
        }
        return value;
    }

    private static final class ValidationErrors {
        private ValidationErrors() {
        }

        private static ValidationException single(String field, String reason) {
            return new ValidationException("Validation failed", List.of(new ValidationDetail(field, reason)));
        }
    }
}
