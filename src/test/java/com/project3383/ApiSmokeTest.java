package com.project3383;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "spring.datasource.url=jdbc:sqlite:target/test-project3383.db")
@AutoConfigureMockMvc
class ApiSmokeTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void guestCanClaimAnAccountAndSignInAgain() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest"))
            .andExpect(status().isOk())
            .andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        String email = "claim-" + System.nanoTime() + "@example.com";

        mockMvc.perform(post("/api/auth/signup")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "name", "Smoke User",
                    "email", email,
                    "password", "Password123"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user.email").value(email))
            .andExpect(jsonPath("$.user.isGuest").value(0));

        mockMvc.perform(post("/api/auth/signin")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "email", email,
                    "password", "Password123"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user.email").value(email));
    }

    @Test
    void guestCanCreateAndMoveATask() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user.name").value("Guest"))
            .andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();
        String doing = board.path("columns").get(1).path("id").asText();

        String taskJson = objectMapper.writeValueAsString(Map.of(
            "workspaceId", workspaceId,
            "boardId", boardId,
            "columnId", todo,
            "title", "Smoke task",
            "estimateMinutes", 30,
            "labels", List.of("smoke")
        ));
        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(taskJson))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.task.title").value("Smoke task"))
            .andExpect(jsonPath("$.task.labels[0].name").value("smoke"))
            .andReturn();
        JsonNode task = objectMapper.readTree(created.getResponse().getContentAsString()).path("task");

        MockMultipartFile attachment = new MockMultipartFile("file", "note.txt", "text/plain", "hello".getBytes());
        MvcResult uploaded = mockMvc.perform(multipart("/api/tasks/" + task.path("id").asText() + "/attachments")
                .file(attachment)
                .session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.attachment.name").value("note.txt"))
            .andReturn();
        String attachmentId = objectMapper.readTree(uploaded.getResponse().getContentAsString())
            .path("attachment").path("id").asText();
        mockMvc.perform(get("/api/attachments/" + attachmentId).session(session))
            .andExpect(status().isOk())
            .andExpect(content().bytes("hello".getBytes()));

        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.columns[0].tasks[0].title").value("Smoke task"));

        mockMvc.perform(patch("/api/tasks/" + task.path("id").asText() + "/move")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "version", task.path("version").asInt(),
                    "columnId", doing
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.columnId").value(doing));

        String otherJson = objectMapper.writeValueAsString(Map.of(
            "workspaceId", workspaceId,
            "boardId", boardId,
            "columnId", todo,
            "title", "Other task"
        ));
        MvcResult otherCreated = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(otherJson))
            .andExpect(status().isCreated())
            .andReturn();
        String otherId = objectMapper.readTree(otherCreated.getResponse().getContentAsString())
            .path("task").path("id").asText();

        mockMvc.perform(post("/api/tasks/" + otherId + "/dependencies")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("dependsOnTaskId", task.path("id").asText()))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dependencies[0].title").value("Smoke task"));

        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/dependencies")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("dependsOnTaskId", otherId))))
            .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/comments")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("body", "First comment"))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.comment.body").value("First comment"));

        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/subtasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("title", "First step"))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.subtask.title").value("First step"));

        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/reminders")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "remindAt", java.time.Instant.now().plusSeconds(3600).toString()
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reminders[0].channel").value("in_app"));

        mockMvc.perform(get("/api/tasks/" + task.path("id").asText()).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.comments[0].body").value("First comment"))
            .andExpect(jsonPath("$.task.subtasks[0].title").value("First step"))
            .andExpect(jsonPath("$.task.reminders[0].channel").value("in_app"));

        mockMvc.perform(post("/api/workspaces/" + workspaceId + "/invites")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "email", "invitee@example.com",
                    "role", "MEMBER"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").isNotEmpty())
            .andExpect(jsonPath("$.invite.email").value("invitee@example.com"));

        mockMvc.perform(get("/api/today").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.workspace.id").value(workspaceId))
            .andExpect(jsonPath("$.suggestions[0].title").value("Smoke task"));

        mockMvc.perform(post("/api/today")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "accept",
                    "taskId", task.path("id").asText(),
                    "workspaceId", workspaceId
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.capacity.selectedMinutes").value(30))
            .andExpect(jsonPath("$.suggestions[0].accepted").value(true));

        mockMvc.perform(post("/api/today")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "dismiss",
                    "taskId", task.path("id").asText(),
                    "workspaceId", workspaceId
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.suggestions[?(@.title == 'Smoke task')]").isEmpty());

        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/complete").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.completed").value(1));
        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/reopen").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.completed").value(0));

        mockMvc.perform(post("/api/auto-plan")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "preview",
                    "workspaceId", workspaceId
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.options[0].id").value("balanced"));

        MvcResult appliedPlan = mockMvc.perform(post("/api/auto-plan")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "apply",
                    "workspaceId", workspaceId,
                    "optionId", "balanced"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.applied").isNumber())
            .andExpect(jsonPath("$.undoId").isNotEmpty())
            .andReturn();
        String undoId = objectMapper.readTree(appliedPlan.getResponse().getContentAsString())
            .path("undoId").asText();

        mockMvc.perform(post("/api/undo/" + undoId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undone").value(true))
            .andExpect(jsonPath("$.action").value("auto_plan.apply"));

        mockMvc.perform(get("/api/today").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.planBlocks").isEmpty());

        mockMvc.perform(post("/api/tasks")
                .session(session)
                .header("Origin", "https://evil.example")
                .contentType(MediaType.APPLICATION_JSON)
                .content(taskJson))
            .andExpect(status().isForbidden());

        String today = java.time.LocalDate.now().toString();
        mockMvc.perform(get("/api/calendar")
                .session(session)
                .param("workspaceId", workspaceId)
                .param("start", today)
                .param("end", java.time.LocalDate.now().plusDays(7).toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.days").isArray());
        mockMvc.perform(get("/api/search")
                .session(session)
                .param("workspaceId", workspaceId)
                .param("q", "Smoke"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[?(@.title == 'Smoke task')]").isNotEmpty());
        mockMvc.perform(get("/api/insights").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.open").isNumber());
        mockMvc.perform(get("/api/archive").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.tasks").isArray());
        mockMvc.perform(get("/api/upcoming").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.days").isArray());
        mockMvc.perform(get("/api/calendar/ics").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.containsString("BEGIN:VCALENDAR")));

        mockMvc.perform(get("/api/settings").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.settings.capacity_minutes").value(300));
        mockMvc.perform(patch("/api/settings")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("capacityMinutes", 240))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.settings.capacity_minutes").value(240));
        mockMvc.perform(patch("/api/settings")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "featuresJson", "{\"dayFlow\":false,\"smartPlan\":true,\"voice\":true}"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.settings.features_json").value("{\"dayFlow\":false,\"smartPlan\":true,\"voice\":true}"));
        mockMvc.perform(patch("/api/account")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "name", "Smoke Owner",
                    "timezone", "Asia/Tokyo"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user.name").value("Smoke Owner"))
            .andExpect(jsonPath("$.user.timezone").value("Asia/Tokyo"));
    }
}
