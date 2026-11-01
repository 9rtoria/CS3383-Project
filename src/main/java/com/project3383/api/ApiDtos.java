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
        com.fasterxml.jackson.databind.JsonNode startDate,
        com.fasterxml.jackson.databind.JsonNode dueDate,
        Boolean dueAllDay,
        com.fasterxml.jackson.databind.JsonNode estimateMinutes,
        com.fasterxml.jackson.databind.JsonNode actualMinutes,
        java.util.List<String> labels,
        com.fasterxml.jackson.databind.JsonNode assigneeId,
        com.fasterxml.jackson.databind.JsonNode recurrenceRule,
        com.fasterxml.jackson.databind.JsonNode recurrenceEndsAt,
        Boolean completed,
        Boolean archived,
        com.fasterxml.jackson.databind.JsonNode reminderOffsetMinutes,
        java.util.List<String> dependencyIds,
        com.fasterxml.jackson.databind.JsonNode focusDate
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
        String visibility,
        String template
    ) {
    }

    public record ColumnCreate(
        String workspaceId,
        String boardId,
        String name,
        String afterId
    ) {
    }

    public record ColumnUpdate(
        String workspaceId,
        String name,
        com.fasterxml.jackson.databind.JsonNode wipLimit,
        Boolean wipEnforced,
        Boolean isDone,
        Integer position
    ) {
    }

    public record ColumnReorder(
        String workspaceId,
        String boardId,
        java.util.List<String> orderedIds
    ) {
    }

    public record LabelCreate(
        String workspaceId,
        String name,
        String color
    ) {
    }

    public record LabelDelete(
        String workspaceId,
        String labelId
    ) {
    }

    public record ViewCreate(
        String workspaceId,
        String name,
        String type,
        String filtersJson,
        Boolean isFavorite
    ) {
    }

    public record ViewDelete(
        String workspaceId,
        String id
    ) {
    }

    public record ClientErrorCreate(
        String message,
        String stack,
        String url
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

    public record ApiTokenCreate(
        String workspaceId,
        String name,
        Integer expiresInDays
    ) {
    }

    public record WebhookCreate(
        String workspaceId,
        String kind,
        String url,
        java.util.List<String> events
    ) {
    }

    public record WebhookUpdate(
        String kind,
        String url,
        Boolean enabled,
        java.util.List<String> events
    ) {
    }

    public record AutomationCreate(
        String workspaceId,
        String boardId,
        String name,
        String trigger,
        String conditionsJson,
        String actionType,
        String actionValue,
        Boolean enabled
    ) {
    }

    public record AutomationUpdate(
        String workspaceId,
        String boardId,
        String name,
        Boolean enabled,
        String trigger,
        String conditionsJson,
        String actionType,
        String actionValue
    ) {
    }

    public record AutomationPreviewInput(
        String workspaceId,
        String boardId,
        String trigger,
        String conditionsJson,
        String actionType,
        String actionValue
    ) {
    }

    public record AccountDelete(String confirm) {
    }

    public record ImportRequest(
        String workspaceId,
        String boardId,
        String format,
        String content
    ) {
    }

    public record WorkspaceCreate(
        String name,
        String type
    ) {
    }

    public record SsoConfigRequest(
        String issuer,
        String clientId,
        String clientSecret,
        String allowedDomains,
        Boolean enabled,
        Boolean enforceSso
    ) {
    }

    public record WorkspaceUpdate(
        String name,
        Integer retentionDays,
        Integer auditRetentionDays,
        Boolean requireMfa,
        Boolean aiEnabled,
        Boolean automationsEnabled,
        Boolean attachmentsEnabled,
        Boolean publicSharingEnabled,
        Integer version
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
        String password,
        String totp
    ) {
    }

    public record MagicRequest(
        String email,
        String next
    ) {
    }

    public record MfaRequest(
        String action,
        String secret,
        String code
    ) {
    }

    public record MfaChallengeRequest(
        String challenge,
        String code
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
