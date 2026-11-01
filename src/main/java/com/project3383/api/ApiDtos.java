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
        String dueDate,
        Integer estimateMinutes
    ) {
    }

    public record TaskUpdate(
        Integer version,
        String title,
        String description,
        String priority,
        String dueDate,
        Integer estimateMinutes
    ) {
    }

    public record TaskMove(
        Integer version,
        String columnId
    ) {
    }

    public record TodayAction(
        String action,
        String taskId
    ) {
    }

    public record Signup(
        String name,
        String email,
        String password,
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
}
