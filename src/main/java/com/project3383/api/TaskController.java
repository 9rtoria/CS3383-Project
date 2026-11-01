package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final AppService appService;

    public TaskController(AppService appService) {
        this.appService = appService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpSession session, @RequestBody ApiDtos.TaskCreate input) {
        return appService.createTask(CurrentUser.id(session), input);
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(HttpSession session, @PathVariable String id, @RequestBody ApiDtos.TaskUpdate input) {
        return appService.updateTask(CurrentUser.id(session), id, input);
    }

    @PatchMapping("/{id}/move")
    public Map<String, Object> move(HttpSession session, @PathVariable String id, @RequestBody ApiDtos.TaskMove input) {
        return appService.moveTask(CurrentUser.id(session), id, input);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpSession session, @PathVariable String id) {
        return appService.deleteTask(CurrentUser.id(session), id);
    }
}
