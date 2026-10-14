package com.example.kanbanplanner.controller;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.kanbanplanner.support.TestRuntimeDataSupport;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "planner.storage.runtime-path=./target/test-data/plan-controller/planner-data.json")
class PlanControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @BeforeEach
    void resetRuntimeData() throws Exception {
        Path runtimePath = Path.of("target", "test-data", "plan-controller", "planner-data.json");
        TestRuntimeDataSupport.resetRuntimeData(runtimePath);
    }

    @Test
    void listPlansReturnsSummaries() throws Exception {
        mockMvc.perform(get("/api/plans"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id").value("pln_seed_001"))
                .andExpect(jsonPath("$[0].name").value("Sample Plan"));
    }

    @Test
    void getPlanReturnsPlanDetailWithLabelEnums() throws Exception {
        mockMvc.perform(get("/api/plans/pln_seed_001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("pln_seed_001"))
                .andExpect(jsonPath("$.tasks[0].progress").value("Not started"))
                .andExpect(jsonPath("$.tasks[0].priority").value("Medium"))
                .andExpect(jsonPath("$.progressOrder[0]").value("Not started"))
                .andExpect(jsonPath("$.progressOrder[1]").value("In progress"))
                .andExpect(jsonPath("$.progressOrder[2]").value("Completed"));
    }

    @Test
    void createPlanReturnsCreatedWithDefaultBuckets() throws Exception {
        String body = """
                {
                  "name": "  Milestone Plan  "
                }
                """;

        mockMvc.perform(post("/api/plans")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Milestone Plan"))
                .andExpect(jsonPath("$.buckets", hasSize(3)))
                .andExpect(jsonPath("$.buckets[0].name").value("To Do"))
                .andExpect(jsonPath("$.buckets[1].name").value("Doing"))
                .andExpect(jsonPath("$.buckets[2].name").value("Done"));
    }

    @Test
    void createPlanWithInvalidBoundaryReturnsStructuredValidationError() throws Exception {
        String body = """
                {
                  "name": "%s"
                }
                """.formatted(repeat("x", 61));

        mockMvc.perform(post("/api/plans")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("Validation failed"))
                .andExpect(jsonPath("$.details[0].field").value("name"));
    }

    @Test
    void updatePlanBlankNameReturnsValidationError() throws Exception {
        String body = """
                {
                  "name": "   "
                }
                """;

        mockMvc.perform(put("/api/plans/pln_seed_001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("name"));
    }

    @Test
    void deletePlanReturnsNoContentAndPlanBecomesNotFound() throws Exception {
        mockMvc.perform(delete("/api/plans/pln_seed_001"))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/plans/pln_seed_001"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void reorderProgressOrderSuccessAndInvalidBody() throws Exception {
        String validBody = """
                {
                  "progressOrder": ["Completed", "Not started", "In progress"]
                }
                """;

        mockMvc.perform(put("/api/plans/pln_seed_001/progress/order")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0]").value("Completed"))
                .andExpect(jsonPath("$[1]").value("Not started"))
                .andExpect(jsonPath("$[2]").value("In progress"));

        mockMvc.perform(get("/api/plans/pln_seed_001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progressOrder[0]").value("Completed"))
                .andExpect(jsonPath("$.progressOrder[1]").value("Not started"))
                .andExpect(jsonPath("$.progressOrder[2]").value("In progress"));

        String invalidBody = """
                {
                  "progressOrder": ["Completed", "Completed", "In progress"]
                }
                """;

        mockMvc.perform(put("/api/plans/pln_seed_001/progress/order")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(invalidBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("progressOrder"));
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < count; index++) {
            builder.append(value);
        }
        return builder.toString();
    }
}
