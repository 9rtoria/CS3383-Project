package com.example.kanbanplanner.repository;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.kanbanplanner.domain.PlanSummary;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class PlannerRepositoryContractTest {

    @Test
    void interfaceDefinesPlannedMethods() {
        Method[] methods = PlannerRepository.class.getDeclaredMethods();
        Map<String, Long> methodCounts = Arrays.stream(methods)
                .collect(Collectors.groupingBy(Method::getName, Collectors.counting()));

        List<String> expected = List.of(
                "findAllPlans",
                "findPlanById",
                "savePlan",
                "deletePlan",
                "saveBucket",
                "deleteBucket",
                "saveTask",
                "deleteTask");

        assertEquals(expected.size(), methods.length);
        for (String name : expected) {
            assertEquals(1L, methodCounts.getOrDefault(name, 0L), "Missing or duplicated method: " + name);
        }
    }

    @Test
    void planSummaryRecordStoresValues() {
        PlanSummary summary = new PlanSummary("pln_001", "Semester Tasks");

        assertEquals("pln_001", summary.id());
        assertEquals("Semester Tasks", summary.name());
    }
}
