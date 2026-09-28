package com.example.kanbanplanner.domain;

public enum Priority {
    URGENT("Urgent"),
    IMPORTANT("Important"),
    MEDIUM("Medium"),
    LOW("Low");

    private final String label;

    Priority(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static Priority fromLabel(String label) {
        for (Priority value : values()) {
            if (value.label.equals(label)) {
                return value;
            }
        }
        throw new IllegalArgumentException("Unknown priority value: " + label);
    }
}
