package com.example.kanbanplanner.service;

import com.example.kanbanplanner.domain.ChecklistItem;
import com.example.kanbanplanner.domain.Plan;
import com.example.kanbanplanner.domain.Priority;
import com.example.kanbanplanner.domain.Progress;
import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.repository.PlannerRepository;
import com.example.kanbanplanner.validation.PlannerValidator;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class TaskService {

    private final PlannerRepository plannerRepository;
    private final PlannerValidator validator;
    private final IdGenerator idGenerator;

    public TaskService(PlannerRepository plannerRepository, PlannerValidator validator, IdGenerator idGenerator) {
        this.plannerRepository = plannerRepository;
        this.validator = validator;
        this.idGenerator = idGenerator;
    }

    public Task createTask(String planId, TaskInput input) {
        Plan plan = findPlanRequired(planId);
        ValidatedTaskFields fields = validateTaskInput(plan, input);

        Task newTask = new Task(
                idGenerator.nextTaskId(),
                fields.title(),
                fields.bucketId(),
                fields.progress(),
                fields.priority(),
                fields.startDate(),
                fields.dueDate(),
                fields.notes(),
                fields.checklist());

        List<Task> updatedTasks = new ArrayList<>(plan.tasks());
        updatedTasks.add(newTask);

        Plan updatedPlan = new Plan(plan.id(), plan.name(), plan.buckets(), updatedTasks);
        plannerRepository.savePlan(updatedPlan);
        return newTask;
    }

    public Task updateTask(String planId, String taskId, TaskInput input) {
        Plan plan = findPlanRequired(planId);
        Task existing = findTaskRequired(plan, taskId);

        ValidatedTaskFields fields = validateTaskInput(plan, input);
        Task updatedTask = new Task(
                existing.id(),
                fields.title(),
                fields.bucketId(),
                fields.progress(),
                fields.priority(),
                fields.startDate(),
                fields.dueDate(),
                fields.notes(),
                fields.checklist());

        List<Task> updatedTasks = plan.tasks().stream()
                .map(task -> task.id().equals(existing.id()) ? updatedTask : task)
                .toList();

        Plan updatedPlan = new Plan(plan.id(), plan.name(), plan.buckets(), updatedTasks);
        plannerRepository.savePlan(updatedPlan);
        return updatedTask;
    }

    public void deleteTask(String planId, String taskId) {
        Plan plan = findPlanRequired(planId);
        findTaskRequired(plan, taskId);

        List<Task> updatedTasks = plan.tasks().stream()
                .filter(task -> !task.id().equals(taskId))
                .toList();

        Plan updatedPlan = new Plan(plan.id(), plan.name(), plan.buckets(), updatedTasks);
        plannerRepository.savePlan(updatedPlan);
    }

    public boolean isTaskOverdue(String planId, String taskId, LocalDate today) {
        Plan plan = findPlanRequired(planId);
        Task task = findTaskRequired(plan, taskId);
        return task.isOverdue(today);
    }

    private ValidatedTaskFields validateTaskInput(Plan plan, TaskInput input) {
        String title = validator.validateTaskTitle(input.title());
        String bucketId = validator.validateRequiredBucketId(input.bucketId());
        validator.requireBucketExists(plan, bucketId);

        Progress progress = validator.requireProgress(input.progress());
        Priority priority = validator.requirePriority(input.priority());

        LocalDate startDate = input.startDate();
        LocalDate dueDate = input.dueDate();
        validator.validateDateConsistency(startDate, dueDate);

        List<ChecklistItem> checklist = normalizeChecklist(input.checklist());
        String notes = normalizeNotes(input.notes());

        return new ValidatedTaskFields(title, bucketId, progress, priority, startDate, dueDate, notes, checklist);
    }

    private List<ChecklistItem> normalizeChecklist(List<ChecklistItemInput> inputChecklist) {
        if (inputChecklist == null) {
            return List.of();
        }

        List<ChecklistItem> checklist = new ArrayList<>();
        for (ChecklistItemInput checklistItem : inputChecklist) {
            String text = validator.validateChecklistItemText(checklistItem.text());
            String id = Optional.ofNullable(checklistItem.id())
                    .map(String::trim)
                    .filter(value -> !value.isEmpty())
                    .orElseGet(idGenerator::nextChecklistItemId);
            checklist.add(new ChecklistItem(id, text, checklistItem.completed()));
        }
        return List.copyOf(checklist);
    }

    private String normalizeNotes(String notes) {
        if (notes == null) {
            return null;
        }
        String trimmed = notes.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private Task findTaskRequired(Plan plan, String taskId) {
        return plan.tasks().stream()
                .filter(task -> task.id().equals(taskId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Task not found: " + taskId));
    }

    private Plan findPlanRequired(String planId) {
        return plannerRepository.findPlanById(planId)
                .orElseThrow(() -> new NotFoundException("Plan not found: " + planId));
    }

    public record TaskInput(
            String title,
            String bucketId,
            Progress progress,
            Priority priority,
            LocalDate startDate,
            LocalDate dueDate,
            String notes,
            List<ChecklistItemInput> checklist) {
    }

    public record ChecklistItemInput(String id, String text, boolean completed) {
    }

    private record ValidatedTaskFields(
            String title,
            String bucketId,
            Progress progress,
            Priority priority,
            LocalDate startDate,
            LocalDate dueDate,
            String notes,
            List<ChecklistItem> checklist) {
    }
}
