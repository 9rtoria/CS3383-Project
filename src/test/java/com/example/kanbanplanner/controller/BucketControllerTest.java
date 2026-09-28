package com.example.kanbanplanner.controller;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "planner.storage.runtime-path=./target/test-data/bucket-controller/planner-data.json")
class BucketControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @BeforeEach
    void resetRuntimeData() throws Exception {
        Path runtimePath = Path.of("target", "test-data", "bucket-controller", "planner-data.json");
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
    void createBucketSuccessAndRenameSuccess() throws Exception {
        String createBody = """
                {
                  "name": "Backlog"
                }
                """;

        String createdId = mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Backlog"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        String bucketId = extractField(createdId, "id");

        String renameBody = """
                {
                  "name": "In Review"
                }
                """;

        mockMvc.perform(put("/api/plans/pln_seed_001/buckets/{bucketId}", bucketId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(renameBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(bucketId))
                .andExpect(jsonPath("$.name").value("In Review"));
    }

    @Test
    void createBucketBoundaryLengthZeroAndSixtyOneRejected() throws Exception {
        String zeroBody = """
                {
                  "name": "   "
                }
                """;
        mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(zeroBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("name"));

        String tooLongBody = """
                {
                  "name": "%s"
                }
                """.formatted(repeat("b", 61));
        mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(tooLongBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("name"));
    }

    @Test
    void createBucketBoundaryLengthOneAndSixtyAccepted() throws Exception {
        String oneCharBody = """
                {
                  "name": "A"
                }
                """;
        mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oneCharBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("A"));

        String sixtyCharBody = """
                {
                  "name": "%s"
                }
                """.formatted(repeat("c", 60));
        mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(sixtyCharBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value(repeat("c", 60)));
    }

    @Test
    void createBucketDuplicateCaseInsensitiveRejected() throws Exception {
        String body = """
                {
                  "name": "to do"
                }
                """;

        mockMvc.perform(post("/api/plans/pln_seed_001/buckets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("name"));
    }

    @Test
    void deleteNonEmptyBucketMovesTaskToUncategorized() throws Exception {
        mockMvc.perform(delete("/api/plans/pln_seed_001/buckets/bkt_seed_001"))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/plans/pln_seed_001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.buckets[?(@.name=='Uncategorized')]", hasSize(1)))
                .andExpect(jsonPath("$.tasks[0].bucketId").exists());
    }

    @Test
    void deleteNonEmptyUncategorizedIsRejectedWithClearError() throws Exception {
        mockMvc.perform(delete("/api/plans/pln_seed_001/buckets/bkt_seed_001"))
                .andExpect(status().isNoContent());

        String uncatId = mockMvc.perform(get("/api/plans/pln_seed_001"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String bucketId = extractBucketIdByName(uncatId, "Uncategorized");

        mockMvc.perform(delete("/api/plans/pln_seed_001/buckets/{bucketId}", bucketId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details[0].field").value("bucket"));
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < count; index++) {
            builder.append(value);
        }
        return builder.toString();
    }

    private String extractField(String json, String fieldName) {
        String needle = "\"" + fieldName + "\":\"";
        int start = json.indexOf(needle);
        if (start < 0) {
            throw new IllegalStateException("Missing field: " + fieldName);
        }
        int valueStart = start + needle.length();
        int valueEnd = json.indexOf('"', valueStart);
        return json.substring(valueStart, valueEnd);
    }

    private String extractBucketIdByName(String json, String name) {
        String nameNeedle = "\"name\":\"" + name + "\"";
        int nameIndex = json.indexOf(nameNeedle);
        if (nameIndex < 0) {
            throw new IllegalStateException("Bucket not found: " + name);
        }

        int idKeyIndex = json.lastIndexOf("\"id\":\"", nameIndex);
        if (idKeyIndex < 0) {
            throw new IllegalStateException("Bucket id not found for: " + name);
        }
        int valueStart = idKeyIndex + "\"id\":\"".length();
        int valueEnd = json.indexOf('"', valueStart);
        return json.substring(valueStart, valueEnd);
    }
}
