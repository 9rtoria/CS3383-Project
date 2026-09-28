package com.example.kanbanplanner.dto.response;

import java.time.LocalDate;
import java.util.List;

public record TaskResponse(
        String id,
        String title,
        String bucketId,
        String progress,
        String priority,
        LocalDate startDate,
        LocalDate dueDate,
        String notes,
        List<ChecklistItemResponse> checklist
) {
}
