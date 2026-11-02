package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.app.SessionService;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final String GUEST_MERGE = "project3383.guestMerge";
    private static final Map<String, List<Long>> MAGIC_ATTEMPTS = new ConcurrentHashMap<>();

    private final AppService appService;
    private final SessionService sessionService;

    @Value("${project3383.dev-email-preview:true}")
    private boolean devEmailPreview;

    public AuthController(AppService appService, SessionService sessionService) {
        this.appService = appService;
        this.sessionService = sessionService;
    }

    @PostMapping("/guest")
    public Map<String, Object> guest(HttpServletRequest request, HttpSession session) {
        Object existing = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (existing != null) {
            if (sessionService.touch(session, existing.toString())) {
                return appService.bootstrap(existing.toString());
            }
            session.removeAttribute(AuthInterceptor.SESSION_USER);
        }
        Map<String, Object> boot = appService.createGuest();
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) boot.get("user");
        session.setAttribute(AuthInterceptor.SESSION_USER, user.get("id"));
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, false);
        sessionService.start(session, user.get("id").toString(), request, false);
        return boot;
    }

    @PostMapping("/signup")
    public Map<String, Object> signup(HttpServletRequest request, HttpSession session, @RequestBody ApiDtos.Signup input) {
        Object current = session.getAttribute(AuthInterceptor.SESSION_USER);
        AppService.AuthResult result = appService.signup(current == null ? null : current.toString(), input);
        String oldSessionId = session.getId();
        if (request.getSession(false) != null) request.changeSessionId();
        sessionService.revoke(oldSessionId, result.userId());
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, false);
        sessionService.start(session, result.userId(), request, false);
        return result.bootstrap();
    }

    @PostMapping("/signin")
    public Map<String, Object> signin(HttpServletRequest request, @RequestBody ApiDtos.Signin input) {
        AppService.AuthResult result = appService.signin(input);
        HttpSession old = request.getSession(false);
        Object guestId = old == null ? null : old.getAttribute(AuthInterceptor.SESSION_USER);
        if (result.mfaRequired()) {
            if (old != null && guestId != null) old.setAttribute(GUEST_MERGE, guestId.toString());
            Map<String, Object> challenge = new java.util.LinkedHashMap<>();
            challenge.put("mfaRequired", true);
            challenge.put("challenge", result.challenge());
            return challenge;
        }
        if (old != null) {
            if (guestId != null && !guestId.toString().equals(result.userId())) {
                appService.mergeGuestWorkspace(guestId.toString(), result.userId());
            }
            sessionService.revokeIfPresent(old);
            old.invalidate();
        }
        HttpSession session = request.getSession(true);
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, result.mfaVerified());
        sessionService.start(session, result.userId(), request, result.mfaVerified());
        return appService.bootstrap(result.userId());
    }

    @PostMapping("/mfa/challenge")
    public Map<String, Object> mfaChallenge(HttpServletRequest request, @RequestBody ApiDtos.MfaChallengeRequest input) {
        AppService.AuthResult result = appService.verifyMfaChallenge(
            input == null ? null : input.challenge(), input == null ? null : input.code());
        HttpSession old = request.getSession(false);
        if (old != null) {
            Object guestId = old.getAttribute(GUEST_MERGE);
            if (guestId == null) guestId = old.getAttribute(AuthInterceptor.SESSION_USER);
            if (guestId != null && !guestId.toString().equals(result.userId())) {
                appService.mergeGuestWorkspace(guestId.toString(), result.userId());
            }
            sessionService.revokeIfPresent(old);
            old.invalidate();
        }
        HttpSession session = request.getSession(true);
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
        sessionService.start(session, result.userId(), request, true);
        return appService.bootstrap(result.userId());
    }

    @PostMapping("/magic")
    public Map<String, Object> magic(HttpServletRequest request, HttpSession session,
                                     @RequestBody ApiDtos.MagicRequest input) {
        String state = UUID.randomUUID() + "-" + UUID.randomUUID();
        String email = input == null ? "" : String.valueOf(input.email()).trim().toLowerCase();
        throttleMagicLink(email, request.getRemoteAddr());
        String baseUrl = ServletUriComponentsBuilder.fromCurrentContextPath().toUriString();
        AppService.MagicLink link = appService.requestMagicLink(
            input == null ? null : input.email(),
            request.getRemoteAddr(),
            input == null ? null : input.next(),
            state,
            baseUrl);
        session.setAttribute("project3383.magic.state", state);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sent", true);
        result.put("message", "If that email can receive mail, a one-time link is on its way.");
        if (devEmailPreview && link.devUrl() != null) result.put("devUrl", link.devUrl());
        return result;
    }

    @GetMapping("/magic/verify")
    public ResponseEntity<Void> verifyMagic(HttpServletRequest request,
                                            @RequestParam(required = false) String token,
                                            @RequestParam(required = false) String state,
                                            @RequestParam(required = false) String next) {
        String baseUrl = ServletUriComponentsBuilder.fromCurrentContextPath().toUriString();
        HttpSession session = request.getSession(false);
        Object storedState = session == null ? null : session.getAttribute("project3383.magic.state");
        if (storedState != null) session.removeAttribute("project3383.magic.state");
        if (state == null || storedState == null || !constantTimeEquals(String.valueOf(storedState), state)) {
            return redirect(baseUrl + "/auth?error=magic_state");
        }
        try {
            AppService.MagicLogin login = appService.loginWithMagicToken(token);
            String destination = safeNext(next);
            Object guestId = session == null ? null : session.getAttribute(AuthInterceptor.SESSION_USER);
            if (login.mfaChallenge() != null) {
                if (session != null && guestId != null) session.setAttribute(GUEST_MERGE, guestId.toString());
                return redirect(baseUrl + "/auth?mfa=1&challenge=" + encode(login.mfaChallenge())
                    + "&next=" + encode(destination));
            }
            if (session != null) {
                if (guestId != null && !guestId.toString().equals(login.userId())) {
                    appService.mergeGuestWorkspace(guestId.toString(), login.userId());
                }
                sessionService.revokeIfPresent(session);
                session.invalidate();
            }
            HttpSession fresh = request.getSession(true);
            fresh.setAttribute(AuthInterceptor.SESSION_USER, login.userId());
            fresh.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
            sessionService.start(fresh, login.userId(), request, true);
            return redirect(baseUrl + destination);
        } catch (ApiException exception) {
            return redirect(baseUrl + "/auth?error=magic_invalid");
        }
    }

    private void throttleMagicLink(String email, String remoteAddress) {
        long now = Instant.now().getEpochSecond();
        long cutoff = now - 15 * 60;
        String key = (remoteAddress == null ? "unknown" : remoteAddress) + "|" + email;
        List<Long> attempts = MAGIC_ATTEMPTS.computeIfAbsent(key, ignored -> new ArrayList<>());
        synchronized (attempts) {
            attempts.removeIf(value -> value < cutoff);
            if (attempts.size() >= 5) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                    "Too many sign-in links. Try again in a few minutes.");
            }
            attempts.add(now);
        }
        if (MAGIC_ATTEMPTS.size() > 10_000) {
            MAGIC_ATTEMPTS.entrySet().removeIf(entry -> entry.getValue().stream().allMatch(value -> value < cutoff));
        }
    }

    private ResponseEntity<Void> redirect(String location) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(location)).build();
    }

    private String safeNext(String value) {
        if (value == null || value.isBlank()) return "/";
        String next = value.trim();
        if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
        return next;
    }

    private String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/session")
    public Map<String, Object> session(HttpSession session) {
        Object userId = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (userId == null || !sessionService.touch(session, userId.toString())) {
            return Map.of("authenticated", false);
        }
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("authenticated", true);
        result.put("bootstrap", appService.bootstrap(userId.toString()));
        return result;
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpSession session) {
        Object userId = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (userId == null || !sessionService.touch(session, userId.toString())) {
            throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "No session.");
        }
        return appService.bootstrap(userId.toString());
    }

    @DeleteMapping("/signout")
    public Map<String, Object> signOut(HttpSession session) {
        sessionService.revokeIfPresent(session);
        session.invalidate();
        return Map.of("signedOut", true);
    }
}
