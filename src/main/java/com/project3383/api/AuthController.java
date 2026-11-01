package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AppService appService;

    public AuthController(AppService appService) {
        this.appService = appService;
    }

    @PostMapping("/guest")
    public Map<String, Object> guest(HttpSession session) {
        Object existing = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (existing != null) {
            return appService.bootstrap(existing.toString());
        }
        Map<String, Object> boot = appService.createGuest();
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) boot.get("user");
        session.setAttribute(AuthInterceptor.SESSION_USER, user.get("id"));
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, false);
        return boot;
    }

    @PostMapping("/signup")
    public Map<String, Object> signup(HttpServletRequest request, HttpSession session, @RequestBody ApiDtos.Signup input) {
        Object current = session.getAttribute(AuthInterceptor.SESSION_USER);
        AppService.AuthResult result = appService.signup(current == null ? null : current.toString(), input);
        if (request.getSession(false) != null) request.changeSessionId();
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, false);
        return result.bootstrap();
    }

    @PostMapping("/signin")
    public Map<String, Object> signin(HttpServletRequest request, @RequestBody ApiDtos.Signin input) {
        AppService.AuthResult result = appService.signin(input);
        if (result.mfaRequired()) {
            Map<String, Object> challenge = new java.util.LinkedHashMap<>();
            challenge.put("mfaRequired", true);
            challenge.put("challenge", result.challenge());
            return challenge;
        }
        HttpSession old = request.getSession(false);
        if (old != null) old.invalidate();
        HttpSession session = request.getSession(true);
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, result.mfaVerified());
        return result.bootstrap();
    }

    @PostMapping("/mfa/challenge")
    public Map<String, Object> mfaChallenge(HttpServletRequest request, @RequestBody ApiDtos.MfaChallengeRequest input) {
        AppService.AuthResult result = appService.verifyMfaChallenge(
            input == null ? null : input.challenge(), input == null ? null : input.code());
        HttpSession old = request.getSession(false);
        if (old != null) old.invalidate();
        HttpSession session = request.getSession(true);
        session.setAttribute(AuthInterceptor.SESSION_USER, result.userId());
        session.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
        return result.bootstrap();
    }

    @PostMapping("/magic")
    public Map<String, Object> magic(HttpServletRequest request, HttpSession session,
                                     @RequestBody ApiDtos.MagicRequest input) {
        String state = UUID.randomUUID() + "-" + UUID.randomUUID();
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
        if (link.devUrl() != null) result.put("devUrl", link.devUrl());
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
            if (login.mfaChallenge() != null) {
                return redirect(baseUrl + "/auth?mfa=1&challenge=" + encode(login.mfaChallenge())
                    + "&next=" + encode(destination));
            }
            if (session != null) session.invalidate();
            HttpSession fresh = request.getSession(true);
            fresh.setAttribute(AuthInterceptor.SESSION_USER, login.userId());
            fresh.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
            return redirect(baseUrl + destination);
        } catch (ApiException exception) {
            return redirect(baseUrl + "/auth?error=magic_invalid");
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

    @GetMapping("/me")
    public Map<String, Object> me(HttpSession session) {
        Object userId = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (userId == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "No session.");
        return appService.bootstrap(userId.toString());
    }

    @DeleteMapping("/signout")
    public Map<String, Object> signOut(HttpSession session) {
        session.invalidate();
        return Map.of("signedOut", true);
    }
}
