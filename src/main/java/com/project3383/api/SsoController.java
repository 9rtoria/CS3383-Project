package com.project3383.api;

import com.project3383.app.SessionService;
import com.project3383.app.SsoService;
import com.project3383.auth.AuthInterceptor;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.util.Map;

@RestController
public class SsoController {

    private final SsoService ssoService;
    private final SessionService sessionService;

    public SsoController(SsoService ssoService, SessionService sessionService) {
        this.ssoService = ssoService;
        this.sessionService = sessionService;
    }

    @GetMapping("/api/workspaces/{workspaceId}/sso")
    public Map<String, Object> config(HttpSession session, @PathVariable String workspaceId) {
        return ssoService.config(CurrentUser.id(session), workspaceId);
    }

    @PutMapping("/api/workspaces/{workspaceId}/sso")
    public Map<String, Object> save(HttpSession session, @PathVariable String workspaceId,
                                    @RequestBody ApiDtos.SsoConfigRequest input) {
        return ssoService.saveConfig(CurrentUser.id(session), workspaceId, input);
    }

    @DeleteMapping("/api/workspaces/{workspaceId}/sso")
    public Map<String, Object> remove(HttpSession session, @PathVariable String workspaceId) {
        return ssoService.removeConfig(CurrentUser.id(session), workspaceId);
    }

    @GetMapping("/api/auth/sso/{workspaceId}")
    public ResponseEntity<Void> start(HttpSession session, @PathVariable String workspaceId) {
        String baseUrl = ServletUriComponentsBuilder.fromCurrentContextPath().toUriString();
        String location = ssoService.start(workspaceId, baseUrl, session);
        return redirect(location);
    }

    @GetMapping("/api/auth/sso/{workspaceId}/callback")
    public ResponseEntity<Void> callback(HttpServletRequest request, HttpSession session,
                                         @PathVariable String workspaceId,
                                         @RequestParam(required = false) String code,
                                         @RequestParam(required = false) String state,
                                         @RequestParam(required = false) String error) {
        String baseUrl = ServletUriComponentsBuilder.fromCurrentContextPath().toUriString();
        if (error != null) return redirect(baseUrl + "/?ssoError=access_denied");
        SsoService.Completion completion = ssoService.complete(workspaceId, code, state, baseUrl, session);
        if (completion.error() != null) {
            return redirect(baseUrl + "/?ssoError=" + completion.error());
        }
        if (completion.mfaChallenge() != null) {
            return redirect(baseUrl + "/?ssoMfa=" + completion.mfaChallenge());
        }
        sessionService.revokeIfPresent(session);
        request.changeSessionId();
        session.setAttribute(AuthInterceptor.SESSION_USER, completion.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
        sessionService.start(session, completion.userId(), request, true);
        return redirect(baseUrl + "/");
    }

    private ResponseEntity<Void> redirect(String location) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(location)).build();
    }
}
