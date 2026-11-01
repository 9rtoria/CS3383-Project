package com.project3383.api;

import com.project3383.app.AppService;
import com.project3383.app.MfaService;
import com.project3383.app.OAuthService;
import com.project3383.app.SessionService;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class OAuthController {

    private static final String STATE = "project3383.oauthState";
    private static final String NEXT = "project3383.oauthNext";
    private static final String PROVIDER = "project3383.oauthProvider";

    private final OAuthService oauthService;
    private final AppService appService;
    private final SessionService sessionService;
    private final MfaService mfaService;
    private final JdbcTemplate jdbc;

    public OAuthController(OAuthService oauthService, AppService appService, SessionService sessionService,
                           MfaService mfaService, JdbcTemplate jdbc) {
        this.oauthService = oauthService;
        this.appService = appService;
        this.sessionService = sessionService;
        this.mfaService = mfaService;
        this.jdbc = jdbc;
    }

    @GetMapping("/api/auth/providers")
    public Map<String, Object> providers() {
        return Map.of("providers", oauthService.providers());
    }

    @GetMapping("/api/auth/oauth/{provider}")
    public ResponseEntity<Void> start(HttpServletRequest request, @PathVariable String provider,
                                      @RequestParam(required = false) String next) {
        if (!oauthService.enabled(provider)) {
            return redirect("/auth?error=provider_unavailable");
        }
        HttpSession session = request.getSession(true);
        String state = UUID.randomUUID() + "-" + UUID.randomUUID();
        session.setAttribute(STATE, state);
        session.setAttribute(NEXT, safeNext(next));
        session.setAttribute(PROVIDER, provider);
        String baseUrl = ServletUriComponentsBuilder.fromCurrentContextPath().toUriString();
        return redirect(oauthService.authorizeUrl(provider, state, baseUrl, safeNext(next)));
    }

    @GetMapping("/api/auth/oauth/{provider}/callback")
    public ResponseEntity<Void> callbackGet(HttpServletRequest request, @PathVariable String provider,
                                            @RequestParam(required = false) String code,
                                            @RequestParam(required = false) String state,
                                            @RequestParam(required = false) String error) {
        return complete(request, provider, code, state, error);
    }

    @PostMapping("/api/auth/oauth/{provider}/callback")
    public ResponseEntity<Void> callbackPost(HttpServletRequest request, @PathVariable String provider,
                                             @RequestParam(required = false) String code,
                                             @RequestParam(required = false) String state,
                                             @RequestParam(required = false) String error) {
        return complete(request, provider, code, state, error);
    }

    private ResponseEntity<Void> complete(HttpServletRequest request, String provider, String code,
                                          String state, String error) {
        HttpSession session = request.getSession(false);
        Object storedState = session == null ? null : session.getAttribute(STATE);
        Object storedProvider = session == null ? null : session.getAttribute(PROVIDER);
        String next = session == null ? "/" : safeNext(String.valueOf(session.getAttribute(NEXT)));
        if (session != null) {
            session.removeAttribute(STATE);
            session.removeAttribute(PROVIDER);
            session.removeAttribute(NEXT);
        }
        if (error != null) return redirect("/auth?error=access_denied");
        if (storedState == null || state == null || !storedState.toString().equals(state)
            || storedProvider == null || !provider.equals(storedProvider.toString())) {
            return redirect("/auth?error=state_mismatch");
        }
        if (code == null || code.isBlank()) return redirect("/auth?error=missing_code");
        String baseUrl = ServletUriComponentsBuilder.fromCurrentContextPath().toUriString();
        try {
            OAuthService.Profile profile = oauthService.exchange(provider, baseUrl, code);
            String userId = jdbc.queryForList("""
                SELECT u.id, u.deleted_at AS deletedAt
                FROM oauth_account oa JOIN app_user u ON u.id = oa.user_id
                WHERE oa.provider = ? AND oa.provider_account_id = ?
                """, provider, profile.providerAccountId()).stream().findFirst()
                .map(row -> {
                    if (row.get("deletedAt") != null) {
                        throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", "That account is no longer available.");
                    }
                    return String.valueOf(row.get("id"));
                })
                .orElse(null);
            if (userId == null) {
                HttpSession existing = request.getSession(false);
                Object guestId = existing == null ? null : existing.getAttribute(AuthInterceptor.SESSION_USER);
                String guest = guestId == null ? null : guestId.toString();
                userId = appService.ensureOAuthUser(guest, profile.email(), profile.name());
                if (guest != null && !guest.equals(userId)) {
                    appService.mergeGuestWorkspace(guest, userId);
                }
                jdbc.update("""
                    INSERT OR IGNORE INTO oauth_account (id, user_id, provider, provider_account_id, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """, UUID.randomUUID().toString(), userId, provider,
                    profile.providerAccountId(), Instant.now().toString());
            }
            if (mfaService.mfaEnabled(userId)) {
                String challenge = mfaService.createChallenge(userId);
                String target = "/auth?mfa=1&challenge=" + encode(challenge)
                    + (next.equals("/") ? "" : "&next=" + encode(next));
                return redirect(target);
            }
            HttpSession old = request.getSession(false);
            if (old != null) {
                sessionService.revokeIfPresent(old);
                old.invalidate();
            }
            HttpSession fresh = request.getSession(true);
            fresh.setAttribute(AuthInterceptor.SESSION_USER, userId);
            fresh.setAttribute(AuthInterceptor.MFA_VERIFIED, true);
            sessionService.start(fresh, userId, request, true);
            return redirect(next);
        } catch (Exception exception) {
            return redirect("/auth?error=oauth_failed");
        }
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

    private ResponseEntity<Void> redirect(String location) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(location)).build();
    }
}
