package com.example.kanbanplanner.dto.request;

import java.time.LocalDate;
import java.util.List;

public record TaskUpsertRequest(
        String title,
        String bucketId,
        String progress,
        String priority,
        LocalDate startDate,
        LocalDate dueDate,
        String notes,
        List<ChecklistItemRequest> checklist
) {
}
