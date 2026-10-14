package com.example.kanbanplanner.domain;

import java.util.List;

public enum Progress {
    NOT_STARTED("Not started"),
    IN_PROGRESS("In progress"),
    COMPLETED("Completed");

    private final String label;

    Progress(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static Progress fromLabel(String label) {
        for (Progress value : values()) {
            if (value.label.equals(label)) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown progress value: " + label);
    }

    public static List<Progress> defaultOrder() {
        return List.of(NOT_STARTED, IN_PROGRESS, COMPLETED);
    }
}
