package com.example.kanbanplanner.dto.response;

import java.util.List;

public record PlanDetailResponse(
        String id,
        String name,
        List<BucketResponse> buckets,
        List<TaskResponse> tasks
) {
}
