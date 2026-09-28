package com.example.kanbanplanner.controller;

import com.example.kanbanplanner.dto.response.ApiErrorDetailResponse;
import com.example.kanbanplanner.dto.response.ApiErrorResponse;
import com.example.kanbanplanner.service.NotFoundException;
import com.example.kanbanplanner.validation.ValidationException;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiErrorResponse handleValidation(ValidationException exception) {
        List<ApiErrorDetailResponse> details = exception.details().stream()
                .map(detail -> new ApiErrorDetailResponse(detail.field(), detail.reason()))
                .toList();
        return new ApiErrorResponse("VALIDATION_ERROR", exception.getMessage(), details);
    }

    @ExceptionHandler(NotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiErrorResponse handleNotFound(NotFoundException exception) {
        return new ApiErrorResponse(
                "NOT_FOUND",
                exception.getMessage(),
                List.of(new ApiErrorDetailResponse("resource", exception.getMessage())));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiErrorResponse handleBadRequest(HttpMessageNotReadableException exception) {
        return new ApiErrorResponse(
                "BAD_REQUEST",
                "Malformed request body",
                List.of(new ApiErrorDetailResponse("request", "Request body is malformed or contains invalid values")));
    }
}
