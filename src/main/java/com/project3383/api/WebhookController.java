package com.project3383.api;

import com.project3383.app.WebhookService;
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
@RequestMapping("/api/webhooks")
public class WebhookController {

    private final WebhookService webhookService;

    public WebhookController(WebhookService webhookService) {
        this.webhookService = webhookService;
    }

    @GetMapping
    public Map<String, Object> list(HttpSession session, @RequestParam String workspaceId) {
        return webhookService.list(CurrentUser.id(session), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpSession session, @RequestBody ApiDtos.WebhookCreate input) {
        return webhookService.create(CurrentUser.id(session), input);
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(HttpSession session, @PathVariable String id,
                                      @RequestParam String workspaceId,
                                      @RequestBody ApiDtos.WebhookUpdate input) {
        return webhookService.update(CurrentUser.id(session), workspaceId, id, input);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpSession session, @PathVariable String id,
                                      @RequestParam String workspaceId) {
        return webhookService.delete(CurrentUser.id(session), workspaceId, id);
    }
}
