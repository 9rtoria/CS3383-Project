package com.example.kanbanplanner.domain;

import java.time.LocalDate;
import java.util.List;

public record Task(
        String id,
        String title,
        String bucketId,
        Progress progress,
        Priority priority,
        LocalDate startDate,
        LocalDate dueDate,
        String notes,
        List<ChecklistItem> checklist
) {

    public Task {
        checklist = checklist == null ? List.of() : List.copyOf(checklist);
    }

    public boolean isOverdue(LocalDate today) {
        return dueDate != null
                && progress != Progress.COMPLETED
                && dueDate.isBefore(today);
    }
}
