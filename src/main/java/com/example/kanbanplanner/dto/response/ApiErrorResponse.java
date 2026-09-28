package com.example.kanbanplanner.dto.response;

import java.util.List;

public record ApiErrorResponse(
        String code,
        String message,
        List<ApiErrorDetailResponse> details
) {
}
