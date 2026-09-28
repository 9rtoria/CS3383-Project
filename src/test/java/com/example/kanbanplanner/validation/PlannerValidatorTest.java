package com.example.kanbanplanner.validation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Task;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class PlannerValidatorTest {

    private final PlannerValidator validator = new PlannerValidator();

    @Test
    void validatePlanNameEnforcesBoundaries() {
        assertValidation("name", "is required", () -> validator.validatePlanName(""));
        assertValidation("name", "is required", () -> validator.validatePlanName("   "));

        assertEquals("A", validator.validatePlanName("A"));
        assertEquals(repeat("x", 60), validator.validatePlanName(repeat("x", 60)));

        assertValidation(
                "name",
                "must be between 1 and 60 characters",
                () -> validator.validatePlanName(repeat("x", 61)));
    }

    @Test
    void validateBucketNameEnforcesBoundaries() {
        assertValidation("name", "is required", () -> validator.validateBucketName(""));
        assertEquals("B", validator.validateBucketName("B"));
        assertEquals(repeat("b", 60), validator.validateBucketName(repeat("b", 60)));
        assertValidation(
                "name",
                "must be between 1 and 60 characters",
                () -> validator.validateBucketName(repeat("b", 61)));
    }

    @Test
    void validateTaskTitleEnforcesBoundaries() {
        assertValidation("title", "is required", () -> validator.validateTaskTitle(""));
        assertEquals("T", validator.validateTaskTitle("T"));
        assertEquals(repeat("t", 120), validator.validateTaskTitle(repeat("t", 120)));
        assertValidation(
                "title",
                "must be between 1 and 120 characters",
                () -> validator.validateTaskTitle(repeat("t", 121)));
    }

    @Test
    void validateChecklistItemTextEnforcesBoundaries() {
        assertValidation("checklist.text", "is required", () -> validator.validateChecklistItemText(""));
        assertEquals("C", validator.validateChecklistItemText("C"));
        assertEquals(repeat("c", 120), validator.validateChecklistItemText(repeat("c", 120)));
        assertValidation(
                "checklist.text",
                "must be between 1 and 120 characters",
                () -> validator.validateChecklistItemText(repeat("c", 121)));
    }

    @Test
    void parseProgressLabelRejectsInvalidValue() {
        assertValidation(
                "progress",
                "must be one of: Not started, In progress, Completed",
                () -> validator.parseProgressLabel("Done"));
    }

    @Test
    void parsePriorityLabelRejectsInvalidValue() {
        assertValidation(
                "priority",
                "must be one of: Urgent, Important, Medium, Low",
                () -> validator.parsePriorityLabel("Highest"));
    }

    @Test
    void validateDateConsistencyAllowsSameDayAndRejectsStartAfterDue() {
        LocalDate sameDay = LocalDate.of(2026, 9, 28);
        validator.validateDateConsistency(sameDay, sameDay);

        assertValidation(
                "dueDate",
                "must be on or after startDate",
                () -> validator.validateDateConsistency(LocalDate.of(2026, 9, 29), LocalDate.of(2026, 9, 28)));
    }

    @Test
    void validateBucketNameUniqueIsCaseInsensitiveWithinPlan() {
        Plan plan = new Plan(
                "pln_1",
                "Plan",
                List.of(new Bucket("bkt_1", "Todo")),
                List.of());

        assertValidation(
                "name",
                "must be unique within the plan",
                () -> validator.validateBucketNameUnique(plan, "todo", null));
    }

    @Test
    void requireBucketExistsRejectsMissingBucket() {
        Plan plan = new Plan("pln_1", "Plan", List.of(new Bucket("bkt_1", "Todo")), List.of());

        assertValidation(
                "bucketId",
                "must reference an existing bucket in the plan",
                () -> validator.requireBucketExists(plan, "missing"));
    }

    @Test
    void requireProgressAndPriorityRejectNull() {
        assertValidation("progress", "is required", () -> validator.requireProgress(null));
        assertValidation("priority", "is required", () -> validator.requirePriority(null));
    }

    private void assertValidation(String field, String reason, Runnable action) {
        ValidationException exception = assertThrows(ValidationException.class, action::run);
        assertEquals("Validation failed", exception.getMessage());
        assertEquals(1, exception.details().size());
        assertEquals(field, exception.details().get(0).field());
        assertEquals(reason, exception.details().get(0).reason());
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < count; i++) {
            builder.append(value);
        }
        return builder.toString();
    }
}
