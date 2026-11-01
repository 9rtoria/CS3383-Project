package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class AppController {

    private final AppService appService;

    public AppController(AppService appService) {
        this.appService = appService;
    }

    @GetMapping("/bootstrap")
    public Map<String, Object> bootstrap(HttpSession session) {
        return appService.bootstrap(CurrentUser.id(session));
    }

    @GetMapping("/boards/{id}")
    public Map<String, Object> board(HttpSession session, @PathVariable String id) {
        return appService.board(CurrentUser.id(session), id);
    }

    @PostMapping("/boards")
    public Map<String, Object> createBoard(HttpSession session, @RequestBody ApiDtos.BoardCreate input) {
        return appService.createBoard(CurrentUser.id(session), input);
    }

    @PostMapping("/workspaces")
    public Map<String, Object> createWorkspace(HttpSession session, @RequestBody ApiDtos.WorkspaceCreate input) {
        return appService.createWorkspace(CurrentUser.id(session), input);
    }

    @GetMapping("/today")
    public Map<String, Object> today(HttpSession session) {
        return appService.today(CurrentUser.id(session));
    }

    @PostMapping("/today")
    public Map<String, Object> todayAction(HttpSession session, @RequestBody ApiDtos.TodayAction input) {
        return appService.todayAction(CurrentUser.id(session), input);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "service", "Project3383");
    }
}
