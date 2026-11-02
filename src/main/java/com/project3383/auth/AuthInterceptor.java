package com.project3383.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.app.ApiTokenService;
import com.project3383.app.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Map;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    public static final String SESSION_USER = "project3383.userId";
    public static final String MFA_VERIFIED = "project3383.mfaVerified";
    public static final String TOKEN_USER = "project3383.tokenUserId";
    public static final String TOKEN_WORKSPACE = "project3383.tokenWorkspaceId";
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ApiTokenService apiTokenService;
    private final SessionService sessionService;

    public AuthInterceptor(ApiTokenService apiTokenService, SessionService sessionService) {
        this.apiTokenService = apiTokenService;
        this.sessionService = sessionService;
    }

    public static String tokenWorkspaceId() {
        if (org.springframework.web.context.request.RequestContextHolder.getRequestAttributes()
            instanceof org.springframework.web.context.request.ServletRequestAttributes attributes) {
            Object scoped = attributes.getRequest().getAttribute(TOKEN_WORKSPACE);
            return scoped == null ? null : String.valueOf(scoped);
        }
        return null;
    }

    public static void requireTokenWorkspace(String workspaceId) {
        String scoped = tokenWorkspaceId();
        if (scoped != null && workspaceId != null && !scoped.equals(workspaceId)) {
            throw com.project3383.api.ApiException.forbidden("This API token is scoped to another workspace.");
        }
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if ("GET".equals(request.getMethod()) && request.getRequestURI().matches("^/api/invites/[^/]+$")) {
            return true;
        }
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith("Bearer ")) {
            Map<String, Object> token = apiTokenService.authenticate(authorization.substring(7).trim());
            if (token == null) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setCharacterEncoding("UTF-8");
                response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                    "code", "UNAUTHORIZED",
                    "message", "This API token is invalid or expired."
                )));
                return false;
            }
            request.setAttribute(TOKEN_USER, token.get("userId"));
            request.setAttribute(TOKEN_WORKSPACE, token.get("workspaceId"));
            String requestedWorkspace = request.getHeader("X-Workspace-Id");
            if (requestedWorkspace == null) requestedWorkspace = request.getParameter("workspaceId");
            if (requestedWorkspace != null && !requestedWorkspace.equals(String.valueOf(token.get("workspaceId")))) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setCharacterEncoding("UTF-8");
                response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                    "code", "FORBIDDEN",
                    "message", "This API token is scoped to another workspace."
                )));
                return false;
            }
            return true;
        }

        HttpSession session = request.getSession(false);
        Object userId = session == null ? null : session.getAttribute(SESSION_USER);
        if (userId != null) {
            String method = request.getMethod();
            if (!"GET".equals(method) && !"HEAD".equals(method) && !"OPTIONS".equals(method)) {
                String fetchSite = request.getHeader("Sec-Fetch-Site");
                String origin = request.getHeader("Origin");
                String expected = request.getScheme() + "://" + request.getServerName()
                    + (request.getServerPort() == 80 || request.getServerPort() == 443 ? "" : ":" + request.getServerPort());
                if ("cross-site".equalsIgnoreCase(fetchSite) || (origin != null && !origin.equals(expected))) {
                    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.setCharacterEncoding("UTF-8");
                    response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                        "code", "CSRF_REJECTED",
                        "message", "This request did not come from the app origin."
                    )));
                    return false;
                }
            }
            if (!sessionService.touch(session, userId.toString())) {
                try {
                    session.invalidate();
                } catch (IllegalStateException ignored) {
                    // Session was already invalidated.
                }
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setCharacterEncoding("UTF-8");
                response.getWriter().write(objectMapper.writeValueAsString(Map.of(
                    "code", "UNAUTHORIZED",
                    "message", "This session has expired or was revoked."
                )));
                return false;
            }
            return true;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(Map.of(
            "code", "UNAUTHORIZED",
            "message", "Create a guest session first."
        )));
        return false;
    }
}
