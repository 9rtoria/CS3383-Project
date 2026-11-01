package com.project3383.api;

import com.project3383.app.SettingsService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/settings")
public class SettingsController {

    private final SettingsService settingsService;

    public SettingsController(SettingsService settingsService) {
        this.settingsService = settingsService;
    }

    @GetMapping
    public Map<String, Object> get(HttpSession session) {
        return Map.of("settings", settingsService.get(CurrentUser.id(session)));
    }

    @PatchMapping
    public Map<String, Object> patch(HttpSession session, @RequestBody Map<String, Object> changes) {
        return Map.of("settings", settingsService.patch(CurrentUser.id(session), changes));
    }
}
