package com.example.kanbanplanner.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class PriorityTest {

    @Test
    void fromLabelParsesKnownValues() {
        assertEquals(Priority.URGENT, Priority.fromLabel("Urgent"));
        assertEquals(Priority.IMPORTANT, Priority.fromLabel("Important"));
        assertEquals(Priority.MEDIUM, Priority.fromLabel("Medium"));
        assertEquals(Priority.LOW, Priority.fromLabel("Low"));
    }

    @Test
    void fromLabelRejectsInvalidValue() {
        assertThrows(IllegalArgumentException.class, () -> Priority.fromLabel("Highest"));
    }
}
