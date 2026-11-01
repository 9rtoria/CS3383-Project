package com.project3383.app;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class BoardTemplates {

    private BoardTemplates() {
    }

    public record ColumnTemplate(String name, boolean done, Integer wipLimit) {
    }

    public record Template(String id, String name, String description, List<ColumnTemplate> columns) {
    }

    public static final List<Template> ALL = List.of(
        new Template("blank", "Blank board", "Start with three calm columns.", List.of(
            new ColumnTemplate("To do", false, null),
            new ColumnTemplate("In progress", false, null),
            new ColumnTemplate("Done", true, null)
        )),
        new Template("personal-week", "Personal week", "A gentle weekly rhythm for life admin and side projects.", List.of(
            new ColumnTemplate("This week", false, 7),
            new ColumnTemplate("Today", false, 3),
            new ColumnTemplate("Waiting", false, null),
            new ColumnTemplate("Done", true, null)
        )),
        new Template("project-sprint", "Project sprint", "Shape, build, review, ship.", List.of(
            new ColumnTemplate("Backlog", false, null),
            new ColumnTemplate("Next up", false, 5),
            new ColumnTemplate("In progress", false, 3),
            new ColumnTemplate("Review", false, 4),
            new ColumnTemplate("Done", true, null)
        )),
        new Template("content-calendar", "Content calendar", "Move an idea from spark to published.", List.of(
            new ColumnTemplate("Ideas", false, null),
            new ColumnTemplate("Drafting", false, null),
            new ColumnTemplate("Review", false, null),
            new ColumnTemplate("Scheduled", false, null),
            new ColumnTemplate("Published", true, null)
        ))
    );

    public static Template find(String id) {
        if (id == null) return ALL.get(0);
        return ALL.stream().filter(template -> template.id().equals(id)).findFirst().orElse(ALL.get(0));
    }

    public static List<Map<String, Object>> catalog() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Template template : ALL) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", template.id());
            entry.put("name", template.name());
            entry.put("description", template.description());
            List<Map<String, Object>> columns = new ArrayList<>();
            for (ColumnTemplate column : template.columns()) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("name", column.name());
                item.put("isDone", column.done());
                if (column.wipLimit() != null) item.put("wipLimit", column.wipLimit());
                columns.add(item);
            }
            entry.put("columns", columns);
            result.add(entry);
        }
        return result;
    }
}
