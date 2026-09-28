package com.example.kanbanplanner.domain;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class TaskTest {

    @Test
    void isOverdueFalseWhenDueDateMissing() {
        Task task = new Task(
                "tsk_001",
                "Draft report",
                "bkt_001",
                Progress.IN_PROGRESS,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                null,
                "notes",
                List.of());

        assertFalse(task.isOverdue(LocalDate.of(2026, 9, 15)));
    }

    @Test
    void isOverdueFalseWhenDueDateIsToday() {
        LocalDate today = LocalDate.of(2026, 9, 15);
        Task task = new Task(
                "tsk_001",
                "Draft report",
                "bkt_001",
                Progress.IN_PROGRESS,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                today,
                "notes",
                List.of());

        assertFalse(task.isOverdue(today));
    }

    @Test
    void isOverdueTrueWhenDueYesterdayAndNotCompleted() {
        LocalDate today = LocalDate.of(2026, 9, 15);
        Task task = new Task(
                "tsk_001",
                "Draft report",
                "bkt_001",
                Progress.IN_PROGRESS,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                today.minusDays(1),
                "notes",
                List.of());

        assertTrue(task.isOverdue(today));
    }

    @Test
    void isOverdueFalseWhenDueYesterdayAndCompleted() {
        LocalDate today = LocalDate.of(2026, 9, 15);
        Task task = new Task(
                "tsk_001",
                "Draft report",
                "bkt_001",
                Progress.COMPLETED,
                Priority.IMPORTANT,
                LocalDate.of(2026, 9, 10),
                today.minusDays(1),
                "notes",
                List.of());

        assertFalse(task.isOverdue(today));
    }

    @Test
    void constructorCopiesChecklistDefensively() {
        List<ChecklistItem> source = new ArrayList<>();
        source.add(new ChecklistItem("chk_001", "Outline", false));
        Task task = new Task(
                "tsk_001",
                "Draft report",
                "bkt_001",
                Progress.NOT_STARTED,
                Priority.MEDIUM,
                null,
                null,
                null,
                source);

        source.add(new ChecklistItem("chk_002", "Review", false));
        assertTrue(task.checklist().size() == 1);
        assertThrows(UnsupportedOperationException.class,
                () -> task.checklist().add(new ChecklistItem("chk_003", "Submit", false)));
    }
}
