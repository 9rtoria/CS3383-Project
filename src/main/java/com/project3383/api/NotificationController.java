package com.project3383.api;

import com.project3383.app.NotificationService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public Map<String, Object> list(HttpSession session) {
        return notificationService.list(CurrentUser.id(session));
    }

    @PatchMapping("/{id}/read")
    public Map<String, Object> read(HttpSession session, @PathVariable String id) {
        return notificationService.markRead(CurrentUser.id(session), id);
    }

    @PatchMapping("/read-all")
    public Map<String, Object> readAll(HttpSession session) {
        return notificationService.markAllRead(CurrentUser.id(session));
    }
}
