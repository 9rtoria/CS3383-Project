package com.example.kanbanplanner.dto.request;

import java.util.List;

public record BucketReorderRequest(List<String> bucketIds) {
}
