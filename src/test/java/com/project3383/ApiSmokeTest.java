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

@SpringBootTest(properties = "spring.datasource.url=jdbc:sqlite:target/test-project3383.db")
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
}
