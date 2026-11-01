package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/invites")
public class InviteController {

    private final AppService appService;

    public InviteController(AppService appService) {
        this.appService = appService;
    }

    @GetMapping("/{token}")
    public Map<String, Object> preview(jakarta.servlet.http.HttpServletRequest request, @PathVariable String token) {
        jakarta.servlet.http.HttpSession session = request.getSession(false);
        Object viewerId = session == null ? null
            : session.getAttribute(com.project3383.auth.AuthInterceptor.SESSION_USER);
        return appService.invitePreview(token, viewerId == null ? null : viewerId.toString());
    }

    @PostMapping("/{token}")
    public Map<String, Object> accept(HttpSession session, @PathVariable String token) {
        return appService.acceptInvite(CurrentUser.id(session), token);
    }
}
