package com.example.kanbanplanner.service;

import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class IdGenerator {

    String nextPlanId() {
        return next("pln");
    }

    String nextBucketId() {
        return next("bkt");
    }

    String nextTaskId() {
        return next("tsk");
    }

    String nextChecklistItemId() {
        return next("chk");
    }

    private String next(String prefix) {
        return prefix + "_" + UUID.randomUUID().toString().replace("-", "");
    }
}
