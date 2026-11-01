package com.project3383.api;

import com.project3383.app.MfaService;
import com.project3383.auth.AuthInterceptor;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/security/mfa")
public class SecurityController {

    private final MfaService mfaService;

    public SecurityController(MfaService mfaService) {
        this.mfaService = mfaService;
    }

    @GetMapping
    public Map<String, Object> status(HttpSession session) {
        return mfaService.status(CurrentUser.id(session), session.getId());
    }

    @PostMapping
    public Map<String, Object> action(HttpSession session, @RequestBody ApiDtos.MfaRequest input) {
        String userId = CurrentUser.id(session);
        if (input == null || input.action() == null) throw ApiException.badRequest("Choose an MFA action.");
        return switch (input.action()) {
            case "setup" -> mfaService.setup(userId, input.code());
            case "enable" -> {
                Map<String, Object> result = mfaService.enable(userId, input);
                session.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
                yield result;
            }
            case "disable" -> {
                Map<String, Object> result = mfaService.disable(userId, input.code());
                session.setAttribute(AuthInterceptor.MFA_VERIFIED, false);
                yield result;
            }
            default -> throw ApiException.badRequest("Choose an MFA action.");
        };
    }

    @DeleteMapping
    public Map<String, Object> revokeSession(HttpSession session, @RequestBody Map<String, String> input) {
        String sessionId = input == null ? null : input.get("sessionId");
        Map<String, Object> result = new LinkedHashMap<>();
        if (sessionId == null || sessionId.equals(session.getId()) || "current".equals(sessionId)) {
            result.put("revoked", false);
            result.put("reason", "Use sign out for the current session.");
            return result;
        }
        mfaService.revokeSession(CurrentUser.id(session), sessionId);
        result.put("revoked", true);
        return result;
    }
}
