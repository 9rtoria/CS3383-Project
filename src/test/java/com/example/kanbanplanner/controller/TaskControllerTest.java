package com.example.kanbanplanner.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "planner.storage.runtime-path=./target/test-data/task-controller/planner-data.json")
class TaskControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @BeforeEach
    void resetRuntimeData() throws Exception {
        Path runtimePath = Path.of("target", "test-data", "task-controller", "planner-data.json");
        Files.createDirectories(runtimePath.getParent());

        try (InputStream inputStream = Thread.currentThread()
                .getContextClassLoader()
                .getResourceAsStream("data/seed-data.json")) {
            if (inputStream == null) {
                throw new IllegalStateException("Missing seed data resource");
            }
            Files.copy(inputStream, runtimePath, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @Test
    void createTaskSuccessAndDeleteSuccess() throws Exception {
        String createBody = """
                {
                  "title": "  Write API tests  ",
                  "bucketId": "bkt_seed_001",
                  "progress": "Not started",
                  "priority": "Important",
                  "startDate": "2026-09-10",
                  "dueDate": "2026-09-20",
                  "notes": "  Notes here  ",
                  "checklist": [
                    { "text": "  Draft assertions  ", "completed": false }
                  ]
                }
                """;

        MvcResult createdResult = mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Write API tests"))
                .andExpect(jsonPath("$.progress").value("Not started"))
                .andExpect(jsonPath("$.priority").value("Important"))
                .andExpect(jsonPath("$.checklist[0].text").value("Draft assertions"))
                .andReturn();

        String taskId = readTree(createdResult).path("id").asText();

        mockMvc.perform(delete("/api/plans/pln_seed_001/tasks/{taskId}", taskId))
                .andExpect(status().isNoContent());
    }

    @Test
    void taskTitleBoundaryLengthZeroAndOneHundredTwentyOneRejected() throws Exception {
        String zeroTitle = baseCreateBody("   ", "Checklist item");
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(zeroTitle))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("title"));

        String tooLongTitle = baseCreateBody(repeat("t", 121), "Checklist item");
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(tooLongTitle))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("title"));
    }

    @Test
    void taskTitleBoundaryLengthOneAndOneHundredTwentyAccepted() throws Exception {
        String oneTitle = baseCreateBody("A", "Checklist item");
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oneTitle))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("A"));

        String maxTitle = baseCreateBody(repeat("x", 120), "Checklist item");
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(maxTitle))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value(repeat("x", 120)));
    }

    @Test
    void checklistTextBoundaryLengthZeroAndOneHundredTwentyOneRejected() throws Exception {
        String zeroChecklist = baseCreateBody("Valid title", "");
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(zeroChecklist))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("checklist.text"));

        String tooLongChecklist = baseCreateBody("Valid title", repeat("c", 121));
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(tooLongChecklist))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("checklist.text"));
    }

    @Test
    void checklistTextBoundaryLengthOneAndOneHundredTwentyAccepted() throws Exception {
        String oneChecklist = baseCreateBody("Valid title", "Z");
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oneChecklist))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist[0].text").value("Z"));

        String maxChecklist = baseCreateBody("Valid title", repeat("m", 120));
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(maxChecklist))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist[0].text").value(repeat("m", 120)));
    }

    @Test
    void dateConsistencyAcceptsSameDayAndRejectsStartAfterDue() throws Exception {
        String sameDay = """
                {
                  "title": "Date task",
                  "bucketId": "bkt_seed_001",
                  "progress": "Not started",
                  "priority": "Medium",
                  "startDate": "2026-09-20",
                  "dueDate": "2026-09-20",
                  "checklist": []
                }
                """;
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(sameDay))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.startDate").value("2026-09-20"))
                .andExpect(jsonPath("$.dueDate").value("2026-09-20"));

        String invalidRange = """
                {
                  "title": "Date task",
                  "bucketId": "bkt_seed_001",
                  "progress": "Not started",
                  "priority": "Medium",
                  "startDate": "2026-09-21",
                  "dueDate": "2026-09-20",
                  "checklist": []
                }
                """;
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(invalidRange))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("dueDate"));
    }

    @Test
    void patchByProgressChangesOnlyProgressAndKeepsBucket() throws Exception {
        String createBody = baseCreateBody("Patch progress", "item");
        MvcResult createdResult = mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode created = readTree(createdResult);
        String taskId = created.path("id").asText();
        String originalBucketId = created.path("bucketId").asText();

        String patchBody = """
                {
                  "progress": "Completed"
                }
                """;
        mockMvc.perform(patch("/api/plans/pln_seed_001/tasks/{taskId}", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(patchBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progress").value("Completed"))
                .andExpect(jsonPath("$.bucketId").value(originalBucketId));
    }

    @Test
    void patchByBucketChangesOnlyBucketAndKeepsProgress() throws Exception {
        String addBucketBody = """
                {
                  "name": "Review"
                }
                """;
        MvcResult bucketResult = mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(addBucketBody))
                .andExpect(status().isCreated())
                .andReturn();
        String newBucketId = readTree(bucketResult).path("id").asText();

        String createBody = baseCreateBody("Patch bucket", "item");
        MvcResult createdResult = mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode created = readTree(createdResult);
        String taskId = created.path("id").asText();
        String originalProgress = created.path("progress").asText();

        String patchBody = """
                {
                  "bucketId": "%s"
                }
                """.formatted(newBucketId);
        mockMvc.perform(patch("/api/plans/pln_seed_001/tasks/{taskId}", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(patchBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bucketId").value(newBucketId))
                .andExpect(jsonPath("$.progress").value(originalProgress));
    }

    @Test
    void patchWithBothOrNeitherFieldsRejected() throws Exception {
        String createBody = baseCreateBody("Patch invalid", "item");
        MvcResult createdResult = mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn();
        String taskId = readTree(createdResult).path("id").asText();

        String bothBody = """
                {
                  "bucketId": "bkt_seed_002",
                  "progress": "Completed"
                }
                """;
        mockMvc.perform(patch("/api/plans/pln_seed_001/tasks/{taskId}", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bothBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("patch"));

        String neitherBody = "{}";
        mockMvc.perform(patch("/api/plans/pln_seed_001/tasks/{taskId}", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(neitherBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("patch"));
    }

    @Test
    void malformedBodyAndInvalidEnumProduceStructuredErrors() throws Exception {
        String malformed = "{\"title\":";
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(malformed))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"))
                .andExpect(jsonPath("$.details[0].field").value("request"));

        String invalidEnum = """
                {
                  "title": "Bad enum",
                  "bucketId": "bkt_seed_001",
                  "progress": "Done",
                  "priority": "Important",
                  "checklist": []
                }
                """;
        mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(invalidEnum))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("progress"));
    }

    @Test
    void putTaskUpdateAndMissingTaskNotFound() throws Exception {
        String createBody = baseCreateBody("Update me", "item");
        MvcResult createdResult = mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode created = readTree(createdResult);
        String taskId = created.path("id").asText();

        String putBody = """
                {
                  "title": "Updated task",
                  "bucketId": "bkt_seed_001",
                  "progress": "In progress",
                  "priority": "Urgent",
                  "startDate": "2026-09-12",
                  "dueDate": "2026-09-22",
                  "notes": "updated",
                  "checklist": [
                    { "id": "chk_a", "text": "done", "completed": true }
                  ]
                }
                """;

        mockMvc.perform(put("/api/plans/pln_seed_001/tasks/{taskId}", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(putBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Updated task"))
                .andExpect(jsonPath("$.progress").value("In progress"))
                .andExpect(jsonPath("$.priority").value("Urgent"));

        mockMvc.perform(put("/api/plans/pln_seed_001/tasks/missing-task")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(putBody))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void patchScopePersistedInPlanDetail() throws Exception {
        String createBody = baseCreateBody("Persisted patch", "item");
        MvcResult createdResult = mockMvc.perform(post("/api/plans/pln_seed_001/tasks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode created = readTree(createdResult);
        String taskId = created.path("id").asText();
        String originalBucketId = created.path("bucketId").asText();

        String patchBody = """
                {
                  "progress": "Completed"
                }
                """;
        mockMvc.perform(patch("/api/plans/pln_seed_001/tasks/{taskId}", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(patchBody))
                .andExpect(status().isOk());

        MvcResult planResult = mockMvc.perform(get("/api/plans/pln_seed_001"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode plan = readTree(planResult);
        JsonNode found = null;
        for (JsonNode task : plan.path("tasks")) {
            if (taskId.equals(task.path("id").asText())) {
                found = task;
                break;
            }
        }

        if (found == null) {
            throw new IllegalStateException("Created task not found in plan response");
        }
        assertEquals("Completed", found.path("progress").asText());
        assertEquals(originalBucketId, found.path("bucketId").asText());
    }

    private JsonNode readTree(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private String baseCreateBody(String title, String checklistText) {
        return """
                {
                  "title": "%s",
                  "bucketId": "bkt_seed_001",
                  "progress": "Not started",
                  "priority": "Medium",
                  "startDate": "2026-09-10",
                  "dueDate": "2026-09-20",
                  "notes": "notes",
                  "checklist": [
                    { "text": "%s", "completed": false }
                  ]
                }
                """.formatted(escapeJson(title), escapeJson(checklistText));
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < count; index++) {
            builder.append(value);
        }
        return builder.toString();
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
