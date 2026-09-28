package com.example.kanbanplanner.validation;

import java.util.List;

public class ValidationException extends RuntimeException {

    private final List<ValidationDetail> details;

    public ValidationException(String message, List<ValidationDetail> details) {
        super(message);
        this.details = List.copyOf(details);
    }

    public List<ValidationDetail> details() {
        return details;
    }
}
