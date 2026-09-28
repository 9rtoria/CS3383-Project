package com.example.kanbanplanner.dto;

import com.example.kanbanplanner.domain.Bucket;
import com.example.kanbanplanner.domain.ChecklistItem;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.PlanSummary;
import com.example.kanbanplanner.domain.Priority;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.dto.request.ChecklistItemRequest;
import com.example.kanbanplanner.dto.request.TaskPatchRequest;
import com.example.kanbanplanner.dto.request.TaskUpsertRequest;
import com.example.kanbanplanner.dto.response.BucketResponse;
import com.example.kanbanplanner.dto.response.ChecklistItemResponse;
import com.example.kanbanplanner.dto.response.PlanDetailResponse;
import com.example.kanbanplanner.dto.response.PlanSummaryResponse;
import com.example.kanbanplanner.dto.response.TaskResponse;
import com.example.kanbanplanner.service.TaskService.ChecklistItemInput;
import com.example.kanbanplanner.service.TaskService.TaskInput;
import com.example.kanbanplanner.service.TaskService.TaskPatchInput;
import com.example.kanbanplanner.validation.PlannerValidator;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class PlannerDtoMapper {

    private final PlannerValidator validator;

    public PlannerDtoMapper(PlannerValidator validator) {
        this.validator = validator;
    }

    public PlanSummaryResponse toPlanSummaryResponse(PlanSummary summary) {
        return new PlanSummaryResponse(summary.id(), summary.name());
    }

    public PlanDetailResponse toPlanDetailResponse(Plan plan) {
        return new PlanDetailResponse(
                plan.id(),
                plan.name(),
                plan.buckets().stream().map(this::toBucketResponse).toList(),
                plan.tasks().stream().map(this::toTaskResponse).toList());
    }

    public BucketResponse toBucketResponse(Bucket bucket) {
        return new BucketResponse(bucket.id(), bucket.name());
    }

    public TaskResponse toTaskResponse(Task task) {
        return new TaskResponse(
                task.id(),
                task.title(),
                task.bucketId(),
                task.progress().label(),
                task.priority().label(),
                task.startDate(),
                task.dueDate(),
                task.notes(),
                task.checklist().stream().map(this::toChecklistItemResponse).toList());
    }

    public TaskInput toTaskInput(TaskUpsertRequest request) {
        return new TaskInput(
                request.title(),
                request.bucketId(),
                parseProgress(request.progress()),
                parsePriority(request.priority()),
                request.startDate(),
                request.dueDate(),
                request.notes(),
                toChecklistInput(request.checklist()));
    }

    public TaskPatchInput toTaskPatchInput(TaskPatchRequest request) {
        return new TaskPatchInput(
                request.bucketId(),
                parseProgress(request.progress()));
    }

    private Progress parseProgress(String progressLabel) {
        if (progressLabel == null) {
            return null;
        }
        return validator.parseProgressLabel(progressLabel.trim());
    }

    private Priority parsePriority(String priorityLabel) {
        if (priorityLabel == null) {
            return null;
        }
        return validator.parsePriorityLabel(priorityLabel.trim());
    }

    private List<ChecklistItemInput> toChecklistInput(List<ChecklistItemRequest> checklist) {
        if (checklist == null) {
            return null;
        }

        return checklist.stream()
                .map(item -> new ChecklistItemInput(item.id(), item.text(), item.completed()))
                .toList();
    }

    private ChecklistItemResponse toChecklistItemResponse(ChecklistItem checklistItem) {
        return new ChecklistItemResponse(checklistItem.id(), checklistItem.text(), checklistItem.completed());
    }
}
