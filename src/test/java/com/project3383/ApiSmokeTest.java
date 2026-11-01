package com.project3383;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.hamcrest.Matchers.nullValue;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:sqlite:target/test-project3383.db",
    "project3383.webhook.allow-private=true"
})
@AutoConfigureMockMvc
class ApiSmokeTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbc;

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

        mockMvc.perform(post("/api/today")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "applyPlan",
                    "workspaceId", workspaceId,
                    "taskIds", java.util.List.of(task.path("id").asText())
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.suggestions[?(@.title == 'Smoke task' && @.accepted == true)]").isNotEmpty());

        mockMvc.perform(post("/api/today")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "rebalance",
                    "workspaceId", workspaceId
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.counts.selected").isNumber());

        mockMvc.perform(post("/api/today")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "applyPlan",
                    "workspaceId", workspaceId,
                    "taskIds", java.util.List.of(otherId)
                ))))
            .andExpect(status().isBadRequest());

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

        mockMvc.perform(post("/api/auto-plan")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "action", "apply",
                    "workspaceId", workspaceId,
                    "optionId", "balanced",
                    "safe", true
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.applied").value(0))
            .andExpect(jsonPath("$.planBlocks").isNotEmpty());

        mockMvc.perform(post("/api/undo/" + undoId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undone").value(true))
            .andExpect(jsonPath("$.action").value("auto_plan.apply"));

        mockMvc.perform(get("/api/today").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.planBlocks").isEmpty());

        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/focus")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("minutes", 10, "complete", false))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.actualMinutes").value(10))
            .andExpect(jsonPath("$.task.completed").value(0));
        mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/focus")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("minutes", 5, "complete", true))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.actualMinutes").value(15))
            .andExpect(jsonPath("$.task.completed").value(1));

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

    @Test
    void boardManagementAssigneeAndRecurrence() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest"))
            .andExpect(status().isOk())
            .andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String userId = boot.path("user").path("id").asText();
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();
        int boardVersion = board.path("version").asInt();

        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.description").value(""))
            .andExpect(jsonPath("$.board.permissions.canManage").value(true))
            .andExpect(jsonPath("$.board.members[0].name").value("Guest"));

        mockMvc.perform(patch("/api/boards/" + boardId)
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "name", "Renamed board",
                    "description", "A board with a clearer purpose.",
                    "visibility", "private",
                    "version", boardVersion
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.name").value("Renamed board"))
            .andExpect(jsonPath("$.board.description").value("A board with a clearer purpose."))
            .andExpect(jsonPath("$.board.visibility").value("private"))
            .andExpect(jsonPath("$.board.version").value(boardVersion + 1));

        MvcResult duplicated = mockMvc.perform(post("/api/boards/" + boardId + "/duplicate").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.name").value("Renamed board copy"))
            .andExpect(jsonPath("$.board.columns[0].tasks").isArray())
            .andReturn();
        String duplicatedId = objectMapper.readTree(duplicated.getResponse().getContentAsString())
            .path("board").path("id").asText();

        Map<String, Object> recurring = new HashMap<>();
        recurring.put("workspaceId", workspaceId);
        recurring.put("boardId", boardId);
        recurring.put("columnId", todo);
        recurring.put("title", "Recurring smoke");
        recurring.put("dueDate", "2026-11-01");
        recurring.put("dueAllDay", true);
        recurring.put("assigneeId", userId);
        recurring.put("recurrenceRule", "FREQ=DAILY;INTERVAL=1");
        recurring.put("labels", List.of("repeat"));
        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(recurring)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.task.assignee.id").value(userId))
            .andExpect(jsonPath("$.task.recurrenceRule").value("FREQ=DAILY;INTERVAL=1"))
            .andReturn();
        JsonNode task = objectMapper.readTree(created.getResponse().getContentAsString()).path("task");

        MvcResult completed = mockMvc.perform(post("/api/tasks/" + task.path("id").asText() + "/complete").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.completed").value(1))
            .andExpect(jsonPath("$.nextTaskId").isString())
            .andReturn();
        String nextTaskId = objectMapper.readTree(completed.getResponse().getContentAsString())
            .path("nextTaskId").asText();

        MvcResult next = mockMvc.perform(get("/api/tasks/" + nextTaskId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.dueDate").value("2026-11-02"))
            .andExpect(jsonPath("$.task.completed").value(0))
            .andExpect(jsonPath("$.task.columnId").value(todo))
            .andExpect(jsonPath("$.task.recurrenceRule").value("FREQ=DAILY;INTERVAL=1"))
            .andExpect(jsonPath("$.task.assignee.id").value(userId))
            .andExpect(jsonPath("$.task.labels[0].name").value("repeat"))
            .andReturn();
        JsonNode nextTask = objectMapper.readTree(next.getResponse().getContentAsString()).path("task");

        Map<String, Object> clear = new HashMap<>();
        clear.put("version", nextTask.path("version").asInt());
        clear.put("title", "Recurring smoke");
        clear.put("description", "");
        clear.put("priority", "none");
        clear.put("startDate", null);
        clear.put("dueDate", null);
        clear.put("dueAllDay", false);
        clear.put("estimateMinutes", null);
        clear.put("actualMinutes", null);
        clear.put("labels", List.of());
        clear.put("assigneeId", null);
        clear.put("recurrenceRule", null);
        clear.put("recurrenceEndsAt", null);
        mockMvc.perform(patch("/api/tasks/" + nextTaskId)
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(clear)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.dueDate").value(nullValue()))
            .andExpect(jsonPath("$.task.assignee").value(nullValue()))
            .andExpect(jsonPath("$.task.recurrenceRule").value(nullValue()));

        mockMvc.perform(patch("/api/tasks/" + nextTaskId)
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "version", nextTask.path("version").asInt() + 1,
                    "assigneeId", "missing-user"
                ))))
            .andExpect(status().isBadRequest());

        mockMvc.perform(patch("/api/boards/" + duplicatedId)
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("archived", true))))
            .andExpect(status().isOk());
        mockMvc.perform(get("/api/bootstrap").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.workspaces[0].boards[?(@.id == '" + duplicatedId + "')]").isEmpty());
        mockMvc.perform(patch("/api/boards/" + duplicatedId)
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("archived", false))))
            .andExpect(status().isOk());
        mockMvc.perform(delete("/api/boards/" + duplicatedId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deleted").value(true));
        mockMvc.perform(get("/api/bootstrap").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.workspaces[0].boards[?(@.id == '" + duplicatedId + "')]").isEmpty());
    }

    @Test
    void privateBoardsAreHiddenFromOtherMembers() throws Exception {
        MvcResult ownerGuest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession ownerSession = (MockHttpSession) ownerGuest.getRequest().getSession(false);
        JsonNode ownerBoot = objectMapper.readTree(ownerGuest.getResponse().getContentAsString());
        JsonNode workspace = ownerBoot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();
        int boardVersion = board.path("version").asInt();

        mockMvc.perform(patch("/api/boards/" + boardId)
                .session(ownerSession)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "visibility", "private",
                    "version", boardVersion
                ))))
            .andExpect(status().isOk());

        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(ownerSession)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Private smoke task"
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        String taskId = objectMapper.readTree(created.getResponse().getContentAsString()).path("task").path("id").asText();

        MvcResult memberGuest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession memberSession = (MockHttpSession) memberGuest.getRequest().getSession(false);
        String memberId = objectMapper.readTree(memberGuest.getResponse().getContentAsString())
            .path("user").path("id").asText();
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)
            """, memberId, workspaceId, Instant.now().toString());

        MvcResult memberBoot = mockMvc.perform(get("/api/bootstrap").session(memberSession))
            .andExpect(status().isOk())
            .andReturn();
        assertFalse(memberBoot.getResponse().getContentAsString().contains(boardId));

        mockMvc.perform(get("/api/boards/" + boardId).session(memberSession))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/tasks/" + taskId).session(memberSession))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/tasks").session(memberSession).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Private smoke task"))));
        mockMvc.perform(get("/api/today").session(memberSession).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Private smoke task"))));
    }

    @Test
    void publicShareLinkIsReadOnlyAndRevocable() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode personalWorkspace = boot.path("workspaces").get(0);
        String personalBoardId = personalWorkspace.path("boards").get(0).path("id").asText();

        mockMvc.perform(post("/api/boards/" + personalBoardId + "/share")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("enabled", true))))
            .andExpect(status().isForbidden());

        String teamName = "Share team " + System.nanoTime();
        MvcResult team = mockMvc.perform(post("/api/workspaces")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", teamName, "type", "team"))))
            .andExpect(status().isOk())
            .andReturn();
        String teamWorkspaceId = objectMapper.readTree(team.getResponse().getContentAsString())
            .path("workspace").path("id").asText();
        JsonNode refreshed = objectMapper.readTree(mockMvc.perform(get("/api/bootstrap").session(session))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        JsonNode teamWorkspace = null;
        for (JsonNode workspace : refreshed.path("workspaces")) {
            if (teamWorkspaceId.equals(workspace.path("id").asText())) teamWorkspace = workspace;
        }
        if (teamWorkspace == null) throw new IllegalStateException("Team workspace missing from bootstrap.");
        JsonNode teamBoard = teamWorkspace.path("boards").get(0);
        String boardId = teamBoard.path("id").asText();
        String todo = teamBoard.path("columns").get(0).path("id").asText();

        Map<String, Object> taskBody = new HashMap<>();
        taskBody.put("workspaceId", teamWorkspaceId);
        taskBody.put("boardId", boardId);
        taskBody.put("columnId", todo);
        taskBody.put("title", "Shared smoke task");
        taskBody.put("description", "Visible on the public page.");
        taskBody.put("priority", "high");
        taskBody.put("dueDate", "2026-11-05");
        taskBody.put("dueAllDay", true);
        taskBody.put("labels", List.of("shared"));
        taskBody.put("assigneeId", boot.path("user").path("id").asText());
        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(taskBody)))
            .andExpect(status().isCreated())
            .andReturn();
        String taskId = objectMapper.readTree(created.getResponse().getContentAsString()).path("task").path("id").asText();
        mockMvc.perform(post("/api/tasks/" + taskId + "/subtasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("title", "Shared step"))))
            .andExpect(status().isCreated());

        MvcResult shared = mockMvc.perform(post("/api/boards/" + boardId + "/share")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("enabled", true))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.enabled").value(true))
            .andExpect(jsonPath("$.token").isString())
            .andExpect(jsonPath("$.url").value(org.hamcrest.Matchers.containsString("/share/")))
            .andReturn();
        String token = objectMapper.readTree(shared.getResponse().getContentAsString()).path("token").asText();

        mockMvc.perform(get("/api/share/" + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.name").value("My tasks"))
            .andExpect(jsonPath("$.board.workspaceName").value(teamName))
            .andExpect(jsonPath("$.board.columns[0].name").value("To do"))
            .andExpect(jsonPath("$.board.tasks[0].title").value("Shared smoke task"))
            .andExpect(jsonPath("$.board.tasks[0].priority").value("high"))
            .andExpect(jsonPath("$.board.tasks[0].completed").value(false))
            .andExpect(jsonPath("$.board.tasks[0].labels[0].name").value("shared"))
            .andExpect(jsonPath("$.board.tasks[0].subtasks[0].title").value("Shared step"))
            .andExpect(jsonPath("$.board.tasks[0].assignee.name").value("Guest"));

        mockMvc.perform(get("/share/" + token))
            .andExpect(status().isOk())
            .andExpect(forwardedUrl("/share.html"));

        mockMvc.perform(post("/api/boards/" + boardId + "/share")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("enabled", false))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.enabled").value(false))
            .andExpect(jsonPath("$.url").value(nullValue()));

        mockMvc.perform(get("/api/share/" + token)).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/share/not-a-real-token")).andExpect(status().isNotFound());
    }

    @Test
    void taskActivityTracksTaskChanges() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();

        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Activity smoke task"
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        String taskId = objectMapper.readTree(created.getResponse().getContentAsString()).path("task").path("id").asText();

        mockMvc.perform(post("/api/tasks/" + taskId + "/comments")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("body", "Activity comment"))))
            .andExpect(status().isCreated());
        mockMvc.perform(post("/api/tasks/" + taskId + "/subtasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("title", "Activity step"))))
            .andExpect(status().isCreated());
        MockMultipartFile file = new MockMultipartFile("file", "activity.txt", "text/plain", "activity".getBytes());
        mockMvc.perform(multipart("/api/tasks/" + taskId + "/attachments")
                .file(file)
                .session(session))
            .andExpect(status().isOk());
        mockMvc.perform(post("/api/tasks/" + taskId + "/complete").session(session))
            .andExpect(status().isOk());
        mockMvc.perform(post("/api/tasks/" + taskId + "/reopen").session(session))
            .andExpect(status().isOk());

        mockMvc.perform(get("/api/tasks/" + taskId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.activity[0].action").value("task.reopened"))
            .andExpect(jsonPath("$.task.activity[0].actor.name").value("Guest"))
            .andExpect(jsonPath("$.task.activity[?(@.action == 'task.created')]").isNotEmpty())
            .andExpect(jsonPath("$.task.activity[?(@.action == 'task.completed')]").isNotEmpty())
            .andExpect(jsonPath("$.task.activity[?(@.action == 'task.reopened')]").isNotEmpty())
            .andExpect(jsonPath("$.task.activity[?(@.action == 'comment.created')]").isNotEmpty())
            .andExpect(jsonPath("$.task.activity[?(@.action == 'subtask.created')]").isNotEmpty())
            .andExpect(jsonPath("$.task.activity[?(@.action == 'attachment.created')]").isNotEmpty());
    }

    @Test
    void taskUndoRestoresCreateCompleteMoveAndDelete() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();
        String done = board.path("columns").get(2).path("id").asText();

        Map<String, Object> taskBody = new HashMap<>();
        taskBody.put("workspaceId", workspaceId);
        taskBody.put("boardId", boardId);
        taskBody.put("columnId", todo);
        taskBody.put("title", "Undo create task");
        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(taskBody)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.undo.id").isString())
            .andReturn();
        JsonNode createdTask = objectMapper.readTree(created.getResponse().getContentAsString());
        String createdId = createdTask.path("task").path("id").asText();
        String createUndoId = createdTask.path("undo").path("id").asText();
        mockMvc.perform(post("/api/undo/" + createUndoId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undone").value(true));
        mockMvc.perform(get("/api/tasks/" + createdId).session(session))
            .andExpect(status().isNotFound());

        Map<String, Object> recurringBody = new HashMap<>(taskBody);
        recurringBody.put("title", "Undo complete task");
        recurringBody.put("dueDate", "2026-11-01");
        recurringBody.put("dueAllDay", true);
        recurringBody.put("recurrenceRule", "FREQ=DAILY;INTERVAL=1");
        MvcResult recurring = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(recurringBody)))
            .andExpect(status().isCreated())
            .andReturn();
        JsonNode recurringTask = objectMapper.readTree(recurring.getResponse().getContentAsString()).path("task");
        String recurringId = recurringTask.path("id").asText();
        MvcResult moved = mockMvc.perform(patch("/api/tasks/" + recurringId + "/move")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "version", recurringTask.path("version").asInt(),
                    "columnId", done
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.nextTaskId").isString())
            .andExpect(jsonPath("$.undo.id").isString())
            .andReturn();
        JsonNode movedPayload = objectMapper.readTree(moved.getResponse().getContentAsString());
        String nextTaskId = movedPayload.path("nextTaskId").asText();
        String moveUndoId = movedPayload.path("undo").path("id").asText();
        mockMvc.perform(post("/api/undo/" + moveUndoId).session(session))
            .andExpect(status().isOk());
        mockMvc.perform(get("/api/tasks/" + recurringId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.columnId").value(todo))
            .andExpect(jsonPath("$.task.completed").value(0));
        mockMvc.perform(get("/api/tasks/" + nextTaskId).session(session))
            .andExpect(status().isNotFound());

        Map<String, Object> deleteBody = new HashMap<>(taskBody);
        deleteBody.put("title", "Undo delete task");
        MvcResult toDelete = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(deleteBody)))
            .andExpect(status().isCreated())
            .andReturn();
        String deleteId = objectMapper.readTree(toDelete.getResponse().getContentAsString()).path("task").path("id").asText();
        MvcResult deleted = mockMvc.perform(delete("/api/tasks/" + deleteId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undo.id").isString())
            .andReturn();
        String deleteUndoId = objectMapper.readTree(deleted.getResponse().getContentAsString()).path("undo").path("id").asText();
        mockMvc.perform(post("/api/undo/" + deleteUndoId).session(session))
            .andExpect(status().isOk());
        mockMvc.perform(get("/api/tasks/" + deleteId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.title").value("Undo delete task"));

        MvcResult expired = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Expired undo task"
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        String expiredUndoId = objectMapper.readTree(expired.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        jdbc.update("UPDATE undo_action SET expires_at = ? WHERE id = ?",
            Instant.now().minusSeconds(60).toString(), expiredUndoId);
        mockMvc.perform(post("/api/undo/" + expiredUndoId).session(session))
            .andExpect(status().isNotFound());

        String autoUndoId = java.util.UUID.randomUUID().toString();
        String today = java.time.LocalDate.now().toString();
        String inverseJson = objectMapper.writeValueAsString(Map.of(
            "startDate", today,
            "endDate", today,
            "previousBlocks", List.of(),
            "previousSelections", List.of(),
            "previousFocus", List.of(),
            "previousArchived", List.of()
        ));
        jdbc.update("""
            INSERT INTO undo_action (id, user_id, workspace_id, action, entity_type,
                                     entity_id, inverse_json, expires_at, created_at)
            VALUES (?, ?, ?, 'auto_plan.apply', 'workspace', ?, ?, ?, ?)
            """, autoUndoId, boot.path("user").path("id").asText(), workspaceId,
            workspaceId, inverseJson, Instant.now().plusSeconds(300).toString(), Instant.now().toString());
        mockMvc.perform(post("/api/undo/" + autoUndoId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undone").value(true))
            .andExpect(jsonPath("$.action").value("auto_plan.apply"));
    }

    @Test
    void boardDeleteUndoRestoresBoardAndTasks() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        String workspaceId = boot.path("workspaces").get(0).path("id").asText();

        MvcResult boardCreated = mockMvc.perform(post("/api/boards")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "Undo board"
                ))))
            .andExpect(status().isOk())
            .andReturn();
        String boardId = objectMapper.readTree(boardCreated.getResponse().getContentAsString())
            .path("board").path("id").asText();
        JsonNode board = objectMapper.readTree(mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("board");
        String todo = board.path("columns").get(0).path("id").asText();
        mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Board undo task"
                ))))
            .andExpect(status().isCreated());

        MvcResult deleted = mockMvc.perform(delete("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undo.id").isString())
            .andReturn();
        String undoId = objectMapper.readTree(deleted.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/undo/" + undoId).session(session))
            .andExpect(status().isOk());
        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.columns[0].tasks[0].title").value("Board undo task"));
    }

    @Test
    void bulkTaskActionsAndUndo() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();
        String doing = board.path("columns").get(1).path("id").asText();
        String done = board.path("columns").get(2).path("id").asText();

        List<String> taskIds = new ArrayList<>();
        for (String title : List.of("Bulk A", "Bulk B", "Bulk C")) {
            MvcResult created = mockMvc.perform(post("/api/tasks")
                    .session(session)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of(
                        "workspaceId", workspaceId,
                        "boardId", boardId,
                        "columnId", todo,
                        "title", title
                    ))))
                .andExpect(status().isCreated())
                .andReturn();
            taskIds.add(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("task").path("id").asText());
        }

        MvcResult completed = mockMvc.perform(post("/api/tasks/bulk")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "taskIds", taskIds.subList(0, 2),
                    "action", "complete"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.affected").value(2))
            .andExpect(jsonPath("$.undo.id").isString())
            .andReturn();
        String completeUndo = objectMapper.readTree(completed.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.completed").value(1))
            .andExpect(jsonPath("$.task.columnId").value(done));
        mockMvc.perform(post("/api/undo/" + completeUndo).session(session)).andExpect(status().isOk());
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.completed").value(0))
            .andExpect(jsonPath("$.task.columnId").value(todo));

        MvcResult archived = mockMvc.perform(post("/api/tasks/bulk")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "taskIds", taskIds.subList(0, 2),
                    "action", "archive"
                ))))
            .andExpect(status().isOk())
            .andReturn();
        String archiveUndo = objectMapper.readTree(archived.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Bulk A"))));
        mockMvc.perform(post("/api/undo/" + archiveUndo).session(session)).andExpect(status().isOk());
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session)).andExpect(status().isOk());

        MvcResult deleted = mockMvc.perform(post("/api/tasks/bulk")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "taskIds", taskIds.subList(0, 2),
                    "action", "delete"
                ))))
            .andExpect(status().isOk())
            .andReturn();
        String deleteUndo = objectMapper.readTree(deleted.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session)).andExpect(status().isNotFound());
        mockMvc.perform(post("/api/undo/" + deleteUndo).session(session)).andExpect(status().isOk());
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session)).andExpect(status().isOk());

        MvcResult moved = mockMvc.perform(post("/api/tasks/bulk")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "taskIds", taskIds.subList(0, 2),
                    "action", "move",
                    "columnId", doing
                ))))
            .andExpect(status().isOk())
            .andReturn();
        String moveUndo = objectMapper.readTree(moved.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.columnId").value(doing));
        mockMvc.perform(post("/api/undo/" + moveUndo).session(session)).andExpect(status().isOk());
        mockMvc.perform(get("/api/tasks/" + taskIds.get(0)).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.columnId").value(todo));

        mockMvc.perform(post("/api/tasks/bulk")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "taskIds", taskIds.subList(0, 2),
                    "action", "move"
                ))))
            .andExpect(status().isBadRequest());

        MvcResult secondBoard = mockMvc.perform(post("/api/boards")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "Bulk other board"
                ))))
            .andExpect(status().isOk())
            .andReturn();
        String secondBoardId = objectMapper.readTree(secondBoard.getResponse().getContentAsString())
            .path("board").path("id").asText();
        JsonNode secondBoardPayload = objectMapper.readTree(
            mockMvc.perform(get("/api/boards/" + secondBoardId).session(session))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()
        ).path("board");
        String secondTodo = secondBoardPayload.path("columns").get(0).path("id").asText();
        MvcResult crossTask = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", secondBoardId,
                    "columnId", secondTodo,
                    "title", "Bulk cross task"
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        String crossTaskId = objectMapper.readTree(crossTask.getResponse().getContentAsString())
            .path("task").path("id").asText();
        mockMvc.perform(post("/api/tasks/bulk")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "taskIds", List.of(taskIds.get(0), crossTaskId),
                    "action", "delete"
                ))))
            .andExpect(status().isBadRequest());
    }

    @Test
    void taskReorderSupportsKeyboardOrderingAndUndo() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();

        List<String> ids = new ArrayList<>();
        for (String title : List.of("Order A", "Order B", "Order C")) {
            MvcResult created = mockMvc.perform(post("/api/tasks")
                    .session(session)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of(
                        "workspaceId", workspaceId,
                        "boardId", boardId,
                        "columnId", todo,
                        "title", title
                    ))))
                .andExpect(status().isCreated())
                .andReturn();
            ids.add(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("task").path("id").asText());
        }

        MvcResult moved = mockMvc.perform(post("/api/tasks/" + ids.get(2) + "/reorder")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("direction", "up"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.moved").value(true))
            .andExpect(jsonPath("$.undo.id").isString())
            .andReturn();
        String undoId = objectMapper.readTree(moved.getResponse().getContentAsString())
            .path("undo").path("id").asText();
        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.columns[0].tasks[0].title").value("Order A"))
            .andExpect(jsonPath("$.board.columns[0].tasks[1].title").value("Order C"))
            .andExpect(jsonPath("$.board.columns[0].tasks[2].title").value("Order B"));
        mockMvc.perform(post("/api/undo/" + undoId).session(session)).andExpect(status().isOk());
        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.columns[0].tasks[0].title").value("Order A"))
            .andExpect(jsonPath("$.board.columns[0].tasks[1].title").value("Order B"))
            .andExpect(jsonPath("$.board.columns[0].tasks[2].title").value("Order C"));

        mockMvc.perform(post("/api/tasks/" + ids.get(0) + "/reorder")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("direction", "down"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.moved").value(true));
        mockMvc.perform(get("/api/boards/" + boardId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.board.columns[0].tasks[0].title").value("Order B"))
            .andExpect(jsonPath("$.board.columns[0].tasks[1].title").value("Order A"));

        mockMvc.perform(post("/api/tasks/" + ids.get(1) + "/reorder")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("direction", "up"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.moved").value(false));
    }

    @Test
    void apiTokensUseBearerAuthAndWriteAuditLog() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        String workspaceId = boot.path("workspaces").get(0).path("id").asText();

        mockMvc.perform(get("/api/tokens").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.tokens").isEmpty());

        MvcResult created = mockMvc.perform(post("/api/tokens")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "CI token",
                    "expiresInDays", 30
                ))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.token").value(org.hamcrest.Matchers.startsWith("drift_pat_")))
            .andExpect(jsonPath("$.record.name").value("CI token"))
            .andExpect(jsonPath("$.record.prefix").isString())
            .andReturn();
        JsonNode tokenPayload = objectMapper.readTree(created.getResponse().getContentAsString());
        String rawToken = tokenPayload.path("token").asText();
        String tokenId = tokenPayload.path("record").path("id").asText();

        mockMvc.perform(get("/api/audit").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.events[?(@.action == 'api_token.created')]").isNotEmpty())
            .andExpect(jsonPath("$.events[0].actor.name").value("Guest"));

        mockMvc.perform(get("/api/tasks")
                .header("Authorization", "Bearer " + rawToken)
                .param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.tasks").isArray());

        MvcResult team = mockMvc.perform(post("/api/workspaces")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "name", "Token other workspace",
                    "type", "team"
                ))))
            .andExpect(status().isOk())
            .andReturn();
        String otherWorkspaceId = objectMapper.readTree(team.getResponse().getContentAsString())
            .path("workspace").path("id").asText();
        mockMvc.perform(get("/api/tasks")
                .header("Authorization", "Bearer " + rawToken)
                .param("workspaceId", otherWorkspaceId))
            .andExpect(status().isForbidden());

        mockMvc.perform(delete("/api/tokens/" + tokenId)
                .session(session)
                .param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.revoked").value(true));

        mockMvc.perform(get("/api/tasks")
                .header("Authorization", "Bearer " + rawToken)
                .param("workspaceId", workspaceId))
            .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/audit").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.events[?(@.action == 'api_token.revoked')]").isNotEmpty());

        MvcResult expired = mockMvc.perform(post("/api/tokens")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "Expired token",
                    "expiresInDays", 1
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        JsonNode expiredPayload = objectMapper.readTree(expired.getResponse().getContentAsString());
        String expiredRaw = expiredPayload.path("token").asText();
        String expiredId = expiredPayload.path("record").path("id").asText();
        jdbc.update("UPDATE api_token SET expires_at = ? WHERE id = ?",
            Instant.now().minusSeconds(60).toString(), expiredId);
        mockMvc.perform(get("/api/tasks")
                .header("Authorization", "Bearer " + expiredRaw)
                .param("workspaceId", workspaceId))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void automationsRunOnEventsPreviewAndUndo() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();

        MvcResult createdRule = mockMvc.perform(post("/api/automations")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "Flag urgent work",
                    "trigger", "task.created",
                    "conditionsJson", "{}",
                    "actionType", "set_priority",
                    "actionValue", "high",
                    "enabled", true
                ))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.rule.name").value("Flag urgent work"))
            .andExpect(jsonPath("$.rule.enabled").value(true))
            .andReturn();
        String ruleId = objectMapper.readTree(createdRule.getResponse().getContentAsString())
            .path("rule").path("id").asText();

        MvcResult createdTask = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Automation target",
                    "priority", "none"
                ))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.task.priority").value("high"))
            .andReturn();
        String taskId = objectMapper.readTree(createdTask.getResponse().getContentAsString())
            .path("task").path("id").asText();

        mockMvc.perform(get("/api/automations").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rules[?(@.id == '" + ruleId + "')].lastRunAt").isNotEmpty())
            .andExpect(jsonPath("$.rules[?(@.id == '" + ruleId + "')].runs[0].taskId").value(taskId));

        mockMvc.perform(post("/api/automations/preview")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "trigger", "task.created",
                    "actionType", "set_priority",
                    "actionValue", "urgent",
                    "conditionsJson", "{}"
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.matches[?(@.taskId == '" + taskId + "')]").isNotEmpty())
            .andExpect(jsonPath("$.matches[?(@.before == 'Priority: high')]").isNotEmpty());

        String undoId = jdbc.queryForObject("""
            SELECT id FROM undo_action WHERE action = 'automation.run' AND workspace_id = ?
            ORDER BY created_at DESC LIMIT 1
            """, String.class, workspaceId);
        mockMvc.perform(post("/api/undo/" + undoId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.undone").value(true));
        mockMvc.perform(get("/api/tasks/" + taskId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.priority").value("none"));

        mockMvc.perform(patch("/api/automations/" + ruleId)
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("workspaceId", workspaceId, "enabled", false))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rule.enabled").value(false));

        mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Automation bypass",
                    "priority", "none"
                ))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.task.priority").value("none"));

        mockMvc.perform(delete("/api/automations/" + ruleId)
                .session(session)
                .param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deleted").value(true));
        mockMvc.perform(get("/api/audit").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.events[?(@.action == 'automation.created')]").isNotEmpty())
            .andExpect(jsonPath("$.events[?(@.action == 'automation.applied')]").isNotEmpty())
            .andExpect(jsonPath("$.events[?(@.action == 'automation.deleted')]").isNotEmpty());
    }

    @Test
    void automationsSupportMoveNotifyAndCompletionTriggers() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();
        String inProgress = board.path("columns").get(1).path("id").asText();

        mockMvc.perform(post("/api/automations")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "name", "Send new work to progress",
                    "trigger", "task.created",
                    "conditionsJson", "{}",
                    "actionType", "move_to_column",
                    "actionValue", inProgress,
                    "enabled", true
                ))))
            .andExpect(status().isCreated());

        MvcResult created = mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Moved by automation",
                    "priority", "none"
                ))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.task.columnId").value(inProgress))
            .andReturn();
        JsonNode createdTask = objectMapper.readTree(created.getResponse().getContentAsString()).path("task");
        int version = createdTask.path("version").asInt();
        String taskId = createdTask.path("id").asText();

        mockMvc.perform(post("/api/automations")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "Notify on move",
                    "trigger", "task.moved",
                    "conditionsJson", "{}",
                    "actionType", "notify",
                    "actionValue", "Moved task needs attention",
                    "enabled", true
                ))))
            .andExpect(status().isCreated());

        mockMvc.perform(patch("/api/tasks/" + taskId + "/move")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("version", version, "columnId", todo))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.columnId").value(todo));
        mockMvc.perform(get("/api/notifications").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.notifications[?(@.title == 'Moved task needs attention')]").isNotEmpty());

        mockMvc.perform(post("/api/automations")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "name", "Urgent on completion",
                    "trigger", "task.completed",
                    "conditionsJson", "{}",
                    "actionType", "set_priority",
                    "actionValue", "urgent",
                    "enabled", true
                ))))
            .andExpect(status().isCreated());

        mockMvc.perform(post("/api/tasks/" + taskId + "/complete").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.task.completed").value(1))
            .andExpect(jsonPath("$.task.priority").value("urgent"));
    }

    @Test
    void exportAndImportRoundTripCsvAndJson() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        JsonNode workspace = boot.path("workspaces").get(0);
        JsonNode board = workspace.path("boards").get(0);
        String workspaceId = workspace.path("id").asText();
        String boardId = board.path("id").asText();
        String todo = board.path("columns").get(0).path("id").asText();

        mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "Exported task",
                    "priority", "medium",
                    "dueDate", "2026-12-15",
                    "labels", List.of("Client")
                ))))
            .andExpect(status().isCreated());
        mockMvc.perform(post("/api/tasks")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "columnId", todo,
                    "title", "=HYPERLINK(\"https://example.com\")"
                ))))
            .andExpect(status().isCreated());

        MvcResult jsonExport = mockMvc.perform(get("/api/export")
                .session(session)
                .param("workspaceId", workspaceId)
                .param("format", "json"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.schemaVersion").value(1))
            .andReturn();
        String exportedJson = jsonExport.getResponse().getContentAsString();
        JsonNode exported = objectMapper.readTree(exportedJson);
        boolean exportedTaskFound = false;
        for (JsonNode exportedBoard : exported.path("boards")) {
            for (JsonNode task : exportedBoard.path("tasks")) {
                if ("Exported task".equals(task.path("title").asText())) {
                    exportedTaskFound = true;
                    if (!"Client".equals(task.path("labels").get(0).asText())) {
                        throw new AssertionError("Exported task label was missing.");
                    }
                }
            }
        }
        if (!exportedTaskFound) throw new AssertionError("Exported task was missing from JSON.");

        MvcResult csvExport = mockMvc.perform(get("/api/export")
                .session(session)
                .param("workspaceId", workspaceId)
                .param("format", "csv"))
            .andExpect(status().isOk())
            .andReturn();
        String exportedCsv = csvExport.getResponse().getContentAsString();
        if (!exportedCsv.startsWith("\uFEFFboard,column,title")) {
            throw new AssertionError("CSV export header was missing.");
        }
        if (!exportedCsv.contains("Exported task") || !exportedCsv.contains("Client")) {
            throw new AssertionError("CSV export did not contain the task or label.");
        }
        if (!exportedCsv.contains("'=HYPERLINK")) {
            throw new AssertionError("CSV formula injection was not neutralized.");
        }

        String csvContent = "title,description,priority,column,dueDate,estimateMinutes,labels,assignee\n"
            + "CSV import,From a CSV,high,To do,2026-12-20,45,Imported,\n";
        mockMvc.perform(post("/api/import")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "format", "csv",
                    "content", csvContent
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.imported").value(1))
            .andExpect(jsonPath("$.skipped").value(0));

        String jsonContent = "{\"tasks\":[{\"title\":\"JSON import\",\"priority\":\"urgent\","
            + "\"column\":\"To do\",\"dueDate\":\"2026-12-31\",\"labels\":[\"JSON label\"]}]}";
        mockMvc.perform(post("/api/import")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "format", "json",
                    "content", jsonContent
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.imported").value(1));

        Map<String, Object> csvTask = jdbc.queryForMap("""
            SELECT priority, due_date AS dueDate, due_all_day AS dueAllDay, estimate_minutes AS estimateMinutes
            FROM task WHERE title = 'CSV import' AND workspace_id = ?
            """, workspaceId);
        if (!"high".equals(csvTask.get("priority")) || !"2026-12-20".equals(csvTask.get("dueDate"))
            || !Integer.valueOf(1).equals(csvTask.get("dueAllDay"))) {
            throw new AssertionError("CSV import did not preserve priority or due date.");
        }
        Map<String, Object> jsonTask = jdbc.queryForMap("""
            SELECT priority, due_date AS dueDate FROM task WHERE title = 'JSON import' AND workspace_id = ?
            """, workspaceId);
        if (!"urgent".equals(jsonTask.get("priority")) || !"2026-12-31".equals(jsonTask.get("dueDate"))) {
            throw new AssertionError("JSON import did not preserve priority or due date.");
        }

        mockMvc.perform(post("/api/import")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                    "workspaceId", workspaceId,
                    "boardId", boardId,
                    "format", "json",
                    "content", "{\"tasks\":[]}"
                ))))
            .andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/audit").session(session).param("workspaceId", workspaceId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.events[?(@.action == 'workspace.exported')]").isNotEmpty())
            .andExpect(jsonPath("$.events[?(@.action == 'workspace.imported')]").isNotEmpty());
    }

    @Test
    void workspaceDeletionRequiresAnotherWorkspaceAndRevokesAccess() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        String firstWorkspaceId = boot.path("workspaces").get(0).path("id").asText();

        MvcResult second = mockMvc.perform(post("/api/workspaces")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Second team", "type", "team"))))
            .andExpect(status().isOk())
            .andReturn();
        JsonNode secondWorkspace = objectMapper.readTree(second.getResponse().getContentAsString())
            .path("workspace");
        String secondWorkspaceId = secondWorkspace.path("id").asText();
        JsonNode refreshed = objectMapper.readTree(mockMvc.perform(get("/api/bootstrap").session(session))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        JsonNode secondBoard = null;
        for (JsonNode workspace : refreshed.path("workspaces")) {
            if (secondWorkspaceId.equals(workspace.path("id").asText())) {
                secondBoard = workspace.path("boards").get(0);
            }
        }
        if (secondBoard == null) throw new AssertionError("Second workspace board was missing.");
        String secondBoardId = secondBoard.path("id").asText();

        MvcResult share = mockMvc.perform(post("/api/boards/" + secondBoardId + "/share")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("enabled", true))))
            .andExpect(status().isOk())
            .andReturn();
        String shareToken = objectMapper.readTree(share.getResponse().getContentAsString())
            .path("token").asText();

        mockMvc.perform(delete("/api/workspaces/" + secondWorkspaceId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deleted").value(true));
        mockMvc.perform(get("/api/share/" + shareToken))
            .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/workspaces/" + firstWorkspaceId).session(session))
            .andExpect(status().isConflict());

        MvcResult third = mockMvc.perform(post("/api/workspaces")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Third team", "type", "team"))))
            .andExpect(status().isOk())
            .andReturn();
        String thirdWorkspaceId = objectMapper.readTree(third.getResponse().getContentAsString())
            .path("workspace").path("id").asText();
        mockMvc.perform(delete("/api/workspaces/" + firstWorkspaceId).session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deleted").value(true));
        mockMvc.perform(get("/api/bootstrap").session(session))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.workspaces[?(@.id == '" + firstWorkspaceId + "')]").isEmpty())
            .andExpect(jsonPath("$.workspaces[?(@.id == '" + thirdWorkspaceId + "')]").isNotEmpty());
        mockMvc.perform(get("/api/tasks").session(session).param("workspaceId", firstWorkspaceId))
            .andExpect(status().isNotFound());
    }

    @Test
    void accountDeletionSoftDeletesUserAndInvalidatesSession() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
        String userId = boot.path("user").path("id").asText();
        String workspaceId = boot.path("workspaces").get(0).path("id").asText();

        mockMvc.perform(delete("/api/account")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("confirm", "NOPE"))))
            .andExpect(status().isBadRequest());
        mockMvc.perform(delete("/api/account")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("confirm", "DELETE"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deleted").value(true));
        mockMvc.perform(get("/api/bootstrap").session(session))
            .andExpect(status().isUnauthorized());

        Map<String, Object> user = jdbc.queryForMap("""
            SELECT email, password_hash AS passwordHash, deleted_at AS deletedAt
            FROM app_user WHERE id = ?
            """, userId);
        if (user.get("deletedAt") == null || user.get("email") != null || user.get("passwordHash") != null) {
            throw new AssertionError("Account deletion did not anonymize and soft-delete the user.");
        }
        Map<String, Object> workspace = jdbc.queryForMap("""
            SELECT deleted_at AS deletedAt FROM workspace WHERE id = ?
            """, workspaceId);
        if (workspace.get("deletedAt") == null) {
            throw new AssertionError("Account deletion did not soft-delete personal workspaces.");
        }

        MvcResult freshGuest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        String freshUserId = objectMapper.readTree(freshGuest.getResponse().getContentAsString())
            .path("user").path("id").asText();
        if (userId.equals(freshUserId)) throw new AssertionError("A fresh guest should use a new account.");
    }

    @Test
    void accountDeletionBlocksSharedTeamOwner() throws Exception {
        MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
        MvcResult team = mockMvc.perform(post("/api/workspaces")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Shared team", "type", "team"))))
            .andExpect(status().isOk())
            .andReturn();
        String workspaceId = objectMapper.readTree(team.getResponse().getContentAsString())
            .path("workspace").path("id").asText();
        String memberId = java.util.UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO app_user (id, email, display_name, password_hash, is_guest, timezone, created_at)
            VALUES (?, ?, 'Team member', NULL, 1, 'UTC', ?)
            """, memberId, "member-" + memberId + "@example.com", Instant.now().toString());
        jdbc.update("""
            INSERT INTO membership (user_id, workspace_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)
            """, memberId, workspaceId, Instant.now().toString());

        mockMvc.perform(delete("/api/account")
                .session(session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("confirm", "DELETE"))))
            .andExpect(status().isConflict());
    }

    @Test
    void webhooksDeliverSignedEventsAndCanBeDeleted() throws Exception {
        com.sun.net.httpserver.HttpServer server = com.sun.net.httpserver.HttpServer.create(
            new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        java.util.concurrent.atomic.AtomicReference<String> receivedBody = new java.util.concurrent.atomic.AtomicReference<>();
        java.util.concurrent.atomic.AtomicReference<String> receivedSignature = new java.util.concurrent.atomic.AtomicReference<>();
        server.createContext("/hook", exchange -> {
            receivedBody.set(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            receivedSignature.set(exchange.getRequestHeaders().getFirst("x-drift-signature"));
            exchange.sendResponseHeaders(200, 0);
            exchange.close();
        });
        server.start();
        try {
            MvcResult guest = mockMvc.perform(post("/api/auth/guest")).andExpect(status().isOk()).andReturn();
            MockHttpSession session = (MockHttpSession) guest.getRequest().getSession(false);
            JsonNode boot = objectMapper.readTree(guest.getResponse().getContentAsString());
            JsonNode workspace = boot.path("workspaces").get(0);
            JsonNode board = workspace.path("boards").get(0);
            String workspaceId = workspace.path("id").asText();
            String boardId = board.path("id").asText();
            String todo = board.path("columns").get(0).path("id").asText();

            MvcResult createdHook = mockMvc.perform(post("/api/webhooks")
                    .session(session)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of(
                        "workspaceId", workspaceId,
                        "kind", "generic",
                        "url", "http://127.0.0.1:" + server.getAddress().getPort() + "/hook",
                        "events", List.of("task.created")
                    ))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.webhook.secret").value(org.hamcrest.Matchers.startsWith("whsec_")))
                .andReturn();
            JsonNode hook = objectMapper.readTree(createdHook.getResponse().getContentAsString()).path("webhook");
            String webhookId = hook.path("id").asText();
            String secret = hook.path("secret").asText();

            mockMvc.perform(get("/api/webhooks").session(session).param("workspaceId", workspaceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.webhooks[0].kind").value("generic"))
                .andExpect(jsonPath("$.webhooks[0].events[0]").value("task.created"));

            mockMvc.perform(patch("/api/webhooks/" + webhookId)
                    .session(session)
                    .param("workspaceId", workspaceId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("enabled", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.webhook.enabled").value(false))
                .andExpect(jsonPath("$.webhook.events[0]").value("task.created"));
            mockMvc.perform(patch("/api/webhooks/" + webhookId)
                    .session(session)
                    .param("workspaceId", workspaceId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("enabled", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.webhook.enabled").value(true))
                .andExpect(jsonPath("$.webhook.events[0]").value("task.created"));

            mockMvc.perform(post("/api/tasks")
                    .session(session)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of(
                        "workspaceId", workspaceId,
                        "boardId", boardId,
                        "columnId", todo,
                        "title", "Webhook task"
                    ))))
                .andExpect(status().isCreated());

            Integer status = null;
            for (int attempt = 0; attempt < 50; attempt++) {
                List<Integer> statuses = jdbc.queryForList("""
                    SELECT status FROM webhook_delivery WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 1
                    """, Integer.class, webhookId);
                if (!statuses.isEmpty() && statuses.get(0) != null) {
                    status = statuses.get(0);
                    break;
                }
                Thread.sleep(100);
            }
            if (status == null) throw new AssertionError("Webhook delivery did not complete.");
            if (status != 200) throw new AssertionError("Expected 200 delivery, got " + status);
            if (receivedBody.get() == null || !receivedBody.get().contains("Webhook task")) {
                throw new AssertionError("Webhook payload did not contain the task title.");
            }
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(
                secret.getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = "sha256=" + java.util.HexFormat.of().formatHex(
                mac.doFinal(receivedBody.get().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            if (!expected.equals(receivedSignature.get())) {
                throw new AssertionError("Webhook signature did not match.");
            }

            mockMvc.perform(delete("/api/webhooks/" + webhookId)
                    .session(session)
                    .param("workspaceId", workspaceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));
            mockMvc.perform(get("/api/audit").session(session).param("workspaceId", workspaceId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.events[?(@.action == 'webhook.created')]").isNotEmpty())
                .andExpect(jsonPath("$.events[?(@.action == 'webhook.deleted')]").isNotEmpty());
        } finally {
            server.stop(0);
        }
    }
}
