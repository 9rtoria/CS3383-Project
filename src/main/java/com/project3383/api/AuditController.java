package com.project3383.api;

import com.project3383.app.AuditService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/audit")
public class AuditController {

    private final AuditService auditService;

    public AuditController(AuditService auditService) {
        this.auditService = auditService;
    }

    @GetMapping
    public Map<String, Object> list(HttpSession session, @RequestParam String workspaceId,
                                    @RequestParam(defaultValue = "50") int limit,
                                    @RequestParam(required = false) String cursor) {
        return auditService.list(CurrentUser.id(session), workspaceId, limit, cursor);
    }
}
