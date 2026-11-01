package com.project3383.api;

import com.project3383.app.ApiTokenService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/tokens")
public class ApiTokenController {

    private final ApiTokenService apiTokenService;

    public ApiTokenController(ApiTokenService apiTokenService) {
        this.apiTokenService = apiTokenService;
    }

    @GetMapping
    public Map<String, Object> list(HttpSession session, @RequestParam String workspaceId) {
        return apiTokenService.list(CurrentUser.id(session), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpSession session, @RequestBody ApiDtos.ApiTokenCreate input) {
        if (input == null) throw ApiException.badRequest("Token details are required.");
        return apiTokenService.create(CurrentUser.id(session), input.workspaceId(), input.name(), input.expiresInDays());
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> revoke(HttpSession session, @PathVariable String id,
                                      @RequestParam String workspaceId) {
        return apiTokenService.revoke(CurrentUser.id(session), workspaceId, id);
    }
}
