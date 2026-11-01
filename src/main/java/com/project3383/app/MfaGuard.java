package com.project3383.app;

import com.project3383.api.ApiException;
import com.project3383.auth.AuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Component
public class MfaGuard {

    private final JdbcTemplate jdbc;

    public MfaGuard(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void requireSatisfied(String userId, String workspaceId) {
        if (!satisfied(userId, workspaceId)) throw mfaRequired();
    }

    public boolean satisfied(String userId, String workspaceId) {
        Integer required = jdbc.queryForObject("""
            SELECT require_mfa FROM workspace WHERE id = ? AND deleted_at IS NULL
            """, Integer.class, workspaceId);
        if (required == null || required == 0) return true;
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) {
            return false;
        }
        HttpServletRequest request = attributes.getRequest();
        Object tokenUser = request.getAttribute(AuthInterceptor.TOKEN_USER);
        if (tokenUser != null) {
            Integer enabled = jdbc.queryForObject("""
                SELECT mfa_enabled FROM app_user WHERE id = ? AND deleted_at IS NULL
                """, Integer.class, userId);
            return enabled != null && enabled == 1;
        }
        HttpSession session = request.getSession(false);
        Object verified = session == null ? null : session.getAttribute(AuthInterceptor.MFA_VERIFIED);
        return Boolean.TRUE.equals(verified);
    }

    private ApiException mfaRequired() {
        return new ApiException(HttpStatus.FORBIDDEN, "MFA_REQUIRED",
            "This workspace requires multi-factor authentication. Enable it in Settings → Security.");
    }
}
