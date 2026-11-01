package com.project3383.auth;

import com.project3383.api.ApiException;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;

public final class CurrentUser {

    private CurrentUser() {
    }

    public static String id(HttpSession session) {
        Object value = session.getAttribute(AuthInterceptor.SESSION_USER);
        if (value == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "No session.");
        }
        return value.toString();
    }
}
