package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.lang.management.ManagementFactory;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AppController {

    private final AppService appService;
    private final JdbcTemplate jdbc;

    public AppController(AppService appService, JdbcTemplate jdbc) {
        this.appService = appService;
        this.jdbc = jdbc;
    }

    @GetMapping("/bootstrap")
    public Map<String, Object> bootstrap(HttpSession session) {
        return appService.bootstrap(CurrentUser.id(session));
    }

    @GetMapping("/boards")
    public Map<String, Object> boards(HttpSession session,
                                      @RequestParam(required = false) String workspaceId) {
        return appService.boardList(CurrentUser.id(session), workspaceId);
    }

    @GetMapping("/boards/{id}")
    public Map<String, Object> board(HttpSession session, @PathVariable String id) {
        return appService.board(CurrentUser.id(session), id);
    }

    @PostMapping("/boards")
    public Map<String, Object> createBoard(HttpSession session, @RequestBody ApiDtos.BoardCreate input) {
        return appService.createBoard(CurrentUser.id(session), input);
    }

    @PatchMapping("/boards/{id}")
    public Map<String, Object> updateBoard(HttpSession session, @PathVariable String id, @RequestBody ApiDtos.BoardUpdate input) {
        return appService.updateBoard(CurrentUser.id(session), id, input);
    }

    @PostMapping("/boards/{id}/duplicate")
    public Map<String, Object> duplicateBoard(HttpSession session, @PathVariable String id) {
        return appService.duplicateBoard(CurrentUser.id(session), id);
    }

    @DeleteMapping("/boards/{id}")
    public Map<String, Object> deleteBoard(HttpSession session, @PathVariable String id) {
        return appService.deleteBoard(CurrentUser.id(session), id);
    }

    @PostMapping("/boards/{id}/share")
    public Map<String, Object> shareBoard(HttpSession session, @PathVariable String id,
                                          @RequestBody ApiDtos.ShareToggle input,
                                          HttpServletRequest request) {
        Map<String, Object> result = appService.toggleBoardShare(CurrentUser.id(session), id, input);
        Map<String, Object> payload = new LinkedHashMap<>(result);
        Object token = result.get("token");
        payload.put("url", token == null ? null : ServletUriComponentsBuilder.fromCurrentContextPath()
            .path("/share/").path(String.valueOf(token)).toUriString());
        return payload;
    }

    @PostMapping("/workspaces")
    public Map<String, Object> createWorkspace(HttpSession session, @RequestBody ApiDtos.WorkspaceCreate input) {
        return appService.createWorkspace(CurrentUser.id(session), input);
    }

    @GetMapping("/today")
    public Map<String, Object> today(HttpSession session, @RequestParam(required = false) String workspaceId) {
        return appService.today(CurrentUser.id(session), workspaceId);
    }

    @PostMapping("/today")
    public Map<String, Object> todayAction(HttpSession session, @RequestBody ApiDtos.TodayAction input) {
        return appService.todayAction(CurrentUser.id(session), input);
    }

    @GetMapping("/calendar")
    public Map<String, Object> calendar(
        HttpSession session,
        @RequestParam String workspaceId,
        @RequestParam String start,
        @RequestParam String end
    ) {
        return appService.calendar(CurrentUser.id(session), workspaceId, start, end);
    }

    @GetMapping("/search")
    public Map<String, Object> search(
        HttpSession session,
        @RequestParam String workspaceId,
        @RequestParam(defaultValue = "") String q,
        @RequestParam(required = false) String status,
        @RequestParam(required = false) String priority,
        @RequestParam(required = false) String boardId,
        @RequestParam(required = false) String label,
        @RequestParam(required = false) String dateFrom,
        @RequestParam(required = false) String dateTo,
        @RequestParam(required = false) String cursor,
        @RequestParam(defaultValue = "30") int limit
    ) {
        return appService.search(CurrentUser.id(session), workspaceId, q, status,
            priority, boardId, label, dateFrom, dateTo, cursor, limit);
    }

    @GetMapping("/insights")
    public Map<String, Object> insights(HttpSession session, @RequestParam String workspaceId,
                                        @RequestParam(defaultValue = "30") int days) {
        return appService.insights(CurrentUser.id(session), workspaceId, days);
    }

    @GetMapping("/archive")
    public Map<String, Object> archive(HttpSession session, @RequestParam String workspaceId) {
        return appService.archive(CurrentUser.id(session), workspaceId);
    }

    @GetMapping("/upcoming")
    public Map<String, Object> upcoming(
        HttpSession session,
        @RequestParam String workspaceId,
        @RequestParam(defaultValue = "14") int days
    ) {
        return appService.upcoming(CurrentUser.id(session), workspaceId, days);
    }

    @GetMapping(value = "/calendar/ics", produces = "text/calendar")
    public ResponseEntity<String> calendarIcs(HttpSession session, @RequestParam String workspaceId) {
        String body = appService.calendarIcs(CurrentUser.id(session), workspaceId);
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("text/calendar; charset=utf-8"))
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"project3383.ics\"")
            .body(body);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        long started = System.nanoTime();
        String database = "ok";
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
        } catch (RuntimeException error) {
            database = "error";
        }
        long latencyMs = Math.max(0, (System.nanoTime() - started) / 1_000_000);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("status", "ok");
        payload.put("version", "1.0.0");
        payload.put("database", database);
        payload.put("latencyMs", latencyMs);
        payload.put("timestamp", Instant.now().toString());
        payload.put("uptimeSeconds", ManagementFactory.getRuntimeMXBean().getUptime() / 1000);
        payload.put("service", "Project3383");
        return payload;
    }
}
