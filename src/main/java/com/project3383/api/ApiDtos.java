package com.project3383.api;

public final class ApiDtos {

    private ApiDtos() {
    }

    public record TaskCreate(
        String workspaceId,
        String boardId,
        String columnId,
        String title,
        String description,
        String priority,
        String startDate,
        String dueDate,
        Boolean dueAllDay,
        Integer estimateMinutes,
        Integer actualMinutes,
        java.util.List<String> labels,
        String assigneeId,
        String recurrenceRule,
        String recurrenceEndsAt
    ) {
    }

    public record TaskUpdate(
        Integer version,
        String title,
        String description,
        String priority,
        java.util.Optional<String> startDate,
        java.util.Optional<String> dueDate,
        Boolean dueAllDay,
        java.util.Optional<Integer> estimateMinutes,
        java.util.Optional<Integer> actualMinutes,
        java.util.List<String> labels,
        java.util.Optional<String> assigneeId,
        java.util.Optional<String> recurrenceRule,
        java.util.Optional<String> recurrenceEndsAt
    ) {
    }

    public record TaskMove(
        Integer version,
        String columnId
    ) {
    }

    public record TodayAction(
        String action,
        String taskId,
        String workspaceId,
        java.util.List<String> taskIds
    ) {
    }

    public record BoardCreate(
        String workspaceId,
        String name,
        String description,
        String visibility
    ) {
    }

    public record BoardUpdate(
        String name,
        String description,
        String visibility,
        Boolean archived,
        Integer version
    ) {
    }

    public record ShareToggle(
        Boolean enabled
    ) {
    }

    public record TaskBulkAction(
        String workspaceId,
        java.util.List<String> taskIds,
        String action,
        String columnId
    ) {
    }

    public record TaskReorder(
        String direction
    ) {
    }

    public record WorkspaceCreate(
        String name,
        String type
    ) {
    }

    public record InviteCreate(
        String email,
        String role
    ) {
    }

    public record MemberRole(
        String role
    ) {
    }

    public record Signup(
        String name,
        String email,
        String password,
        String timezone
    ) {
    }

    public record AccountUpdate(
        String name,
        String timezone
    ) {
    }

    public record Signin(
        String email,
        String password
    ) {
    }

    public record CommentCreate(
        String body
    ) {
    }

    public record SubtaskCreate(
        String title
    ) {
    }

    public record SubtaskUpdate(
        String title,
        Boolean completed
    ) {
    }

    public record DependencyCreate(
        String dependsOnTaskId
    ) {
    }

    public record ReminderCreate(
        String remindAt
    ) {
    }

    public record FocusLog(
        Integer minutes,
        Boolean complete
    ) {
    }

    public record AutoPlanRequest(
        String action,
        String workspaceId,
        String optionId,
        Boolean safe,
        Boolean delegated,
        Integer horizonDays
    ) {
    }
}
