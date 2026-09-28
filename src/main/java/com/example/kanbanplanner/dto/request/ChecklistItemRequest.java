package com.example.kanbanplanner.dto.request;

public record ChecklistItemRequest(String id, String text, boolean completed) {
}
