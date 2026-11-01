package com.project3383.api;

import com.project3383.app.AutoPlanService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auto-plan")
public class AutoPlanController {

    private final AutoPlanService autoPlanService;

    public AutoPlanController(AutoPlanService autoPlanService) {
        this.autoPlanService = autoPlanService;
    }

    @PostMapping
    public Map<String, Object> run(HttpSession session, @RequestBody ApiDtos.AutoPlanRequest input) {
        if (input == null || input.workspaceId() == null) throw ApiException.badRequest("Choose a workspace.");
        String userId = CurrentUser.id(session);
        return switch (input.action() == null ? "preview" : input.action()) {
            case "preview" -> autoPlanService.preview(userId, input.workspaceId());
            case "apply" -> autoPlanService.apply(
                userId,
                input.workspaceId(),
                input.optionId(),
                Boolean.TRUE.equals(input.safe()),
                Boolean.TRUE.equals(input.delegated())
            );
            case "clear" -> autoPlanService.clear(userId, input.workspaceId());
            default -> throw ApiException.badRequest("Unknown Auto-plan action.");
        };
    }
}
