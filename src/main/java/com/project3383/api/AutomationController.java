package com.project3383.api;

import com.project3383.app.AutomationService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/automations")
public class AutomationController {

    private final AutomationService automationService;

    public AutomationController(AutomationService automationService) {
        this.automationService = automationService;
    }

    @GetMapping
    public Map<String, Object> list(HttpSession session, @RequestParam String workspaceId) {
        return automationService.list(CurrentUser.id(session), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpSession session, @RequestBody ApiDtos.AutomationCreate input) {
        return automationService.create(CurrentUser.id(session), input);
    }

    @PostMapping("/preview")
    public Map<String, Object> preview(HttpSession session, @RequestBody ApiDtos.AutomationPreviewInput input) {
        return automationService.preview(CurrentUser.id(session), input);
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(HttpSession session, @PathVariable String id,
                                      @RequestBody ApiDtos.AutomationUpdate input) {
        return automationService.update(CurrentUser.id(session), id, input);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpSession session, @PathVariable String id,
                                      @RequestParam String workspaceId) {
        return automationService.delete(CurrentUser.id(session), workspaceId, id);
    }
}
