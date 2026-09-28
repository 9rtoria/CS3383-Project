package com.example.kanbanplanner.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ChecklistItemTest {

    @Test
    void recordStoresValues() {
        ChecklistItem item = new ChecklistItem("chk_001", "Outline", false);

        assertEquals("chk_001", item.id());
        assertEquals("Outline", item.text());
        assertFalse(item.completed());
    }

    @Test
    void completedFlagCanBeTrue() {
        ChecklistItem item = new ChecklistItem("chk_002", "Review", true);

        assertTrue(item.completed());
    }
}
