package com.project3383.auth;

import com.project3383.api.ApiException;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

public final class CurrentUser {

    private CurrentUser() {
    }

    public static String id(HttpSession session) {
        Object value = session == null ? null : session.getAttribute(AuthInterceptor.SESSION_USER);
        if (value == null) {
            try {
                if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
                    value = attributes.getRequest().getAttribute(AuthInterceptor.TOKEN_USER);
                }
            } catch (Exception ignored) {
                // No request context.
            }
        }
        if (value == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "No session.");
        }
        return value.toString();
    }
}
