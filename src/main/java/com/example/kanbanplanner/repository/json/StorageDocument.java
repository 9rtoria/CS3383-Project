package com.example.kanbanplanner.repository.json;

import com.example.kanbanplanner.domain.Plan;
import java.util.List;

public record StorageDocument(List<Plan> plans) {

    public StorageDocument {
        plans = plans == null ? List.of() : List.copyOf(plans);
    }

    public static StorageDocument empty() {
        return new StorageDocument(List.of());
    }
}
