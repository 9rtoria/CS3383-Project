package com.example.kanbanplanner.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class ProgressTest {

    @Test
    void fromLabelParsesKnownValues() {
        assertEquals(Progress.NOT_STARTED, Progress.fromLabel("Not started"));
        assertEquals(Progress.IN_PROGRESS, Progress.fromLabel("In progress"));
        assertEquals(Progress.COMPLETED, Progress.fromLabel("Completed"));
    }

    @Test
    void fromLabelRejectsInvalidValue() {
        assertThrows(IllegalArgumentException.class, () -> Progress.fromLabel("Done"));
    }
}
