package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class ReminderController {

    private final AppService appService;

    public ReminderController(AppService appService) {
        this.appService = appService;
    }

    @PostMapping("/tasks/{taskId}/reminders")
    public Map<String, Object> add(HttpSession session, @PathVariable String taskId, @RequestBody ApiDtos.ReminderCreate input) {
        return appService.addReminder(CurrentUser.id(session), taskId, input);
    }

    @DeleteMapping("/reminders/{id}")
    public Map<String, Object> remove(HttpSession session, @PathVariable String id) {
        return appService.removeReminder(CurrentUser.id(session), id);
    }
}
