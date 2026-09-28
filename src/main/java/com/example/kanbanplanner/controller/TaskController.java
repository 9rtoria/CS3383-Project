package com.example.kanbanplanner.controller;

import com.example.kanbanplanner.domain.Task;
import com.example.kanbanplanner.dto.PlannerDtoMapper;
import com.example.kanbanplanner.dto.request.TaskPatchRequest;
import com.example.kanbanplanner.dto.request.TaskUpsertRequest;
import com.example.kanbanplanner.dto.response.TaskResponse;
import com.example.kanbanplanner.service.TaskService;
import com.example.kanbanplanner.service.TaskService.TaskInput;
import com.example.kanbanplanner.service.TaskService.TaskPatchInput;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/plans/{planId}/tasks")
public class TaskController {

    private final TaskService taskService;
    private final PlannerDtoMapper mapper;

    public TaskController(TaskService taskService, PlannerDtoMapper mapper) {
        this.taskService = taskService;
        this.mapper = mapper;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TaskResponse createTask(@PathVariable String planId, @RequestBody TaskUpsertRequest request) {
        TaskInput input = mapper.toTaskInput(request);
        Task created = taskService.createTask(planId, input);
        return mapper.toTaskResponse(created);
    }

    @PutMapping("/{taskId}")
    public TaskResponse updateTask(
            @PathVariable String planId,
            @PathVariable String taskId,
            @RequestBody TaskUpsertRequest request) {
        TaskInput input = mapper.toTaskInput(request);
        Task updated = taskService.updateTask(planId, taskId, input);
        return mapper.toTaskResponse(updated);
    }

    @PatchMapping("/{taskId}")
    public TaskResponse patchTask(
            @PathVariable String planId,
            @PathVariable String taskId,
            @RequestBody TaskPatchRequest request) {
        TaskPatchInput input = mapper.toTaskPatchInput(request);
        Task updated = taskService.patchTask(planId, taskId, input);
        return mapper.toTaskResponse(updated);
    }

    @DeleteMapping("/{taskId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTask(@PathVariable String planId, @PathVariable String taskId) {
        taskService.deleteTask(planId, taskId);
    }
}
