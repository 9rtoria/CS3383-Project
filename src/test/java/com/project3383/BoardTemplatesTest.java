package com.project3383;

import com.project3383.app.BoardTemplates;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoardTemplatesTest {

    @Test
    void nullAndUnknownIdsFallBackToBlankTemplate() {
        BoardTemplates.Template blank = BoardTemplates.ALL.get(0);

        assertSame(blank, BoardTemplates.find(null));
        assertSame(blank, BoardTemplates.find("unknown"));
    }

    @ParameterizedTest
    @MethodSource("templates")
    void everyKnownTemplateCanBeFound(BoardTemplates.Template template) {
        assertSame(template, BoardTemplates.find(template.id()));
    }

    @Test
    void catalogPreservesTemplateOrderAndColumnValues() {
        List<Map<String, Object>> catalog = BoardTemplates.catalog();

        assertEquals(BoardTemplates.ALL.size(), catalog.size());
        assertEquals(List.of("blank", "personal-week", "project-sprint", "content-calendar"),
            catalog.stream().map(entry -> entry.get("id")).toList());

        Map<String, Object> personalWeek = catalog.get(1);
        assertEquals("Personal week", personalWeek.get("name"));
        assertEquals("A gentle weekly rhythm for life admin and side projects.",
            personalWeek.get("description"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> columns = (List<Map<String, Object>>) personalWeek.get("columns");
        assertEquals(4, columns.size());
        assertEquals(Map.of("name", "This week", "isDone", false, "wipLimit", 7), columns.get(0));
        assertEquals(Map.of("name", "Today", "isDone", false, "wipLimit", 3), columns.get(1));
        assertFalse(columns.get(2).containsKey("wipLimit"));
        assertEquals(Boolean.TRUE, columns.get(3).get("isDone"));
        assertTrue(columns.get(3).containsKey("name"));
    }

    private static Stream<BoardTemplates.Template> templates() {
        return BoardTemplates.ALL.stream();
    }
}
