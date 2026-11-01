package com.project3383.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
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
