package com.project3383;

import com.project3383.api.ApiException;
import com.project3383.app.MfaGuard;
import com.project3383.auth.AuthInterceptor;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MfaGuardTest {

    @Mock
    private JdbcTemplate jdbc;

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @ParameterizedTest
    @MethodSource("notRequiredValues")
    void workspaceWithoutMfaRequirementIsSatisfied(Integer required) {
        stubMfa(required, null);

        assertTrue(new MfaGuard(jdbc).satisfied("user", "workspace"));
    }

    @Test
    void requiredWorkspaceWithoutRequestContextIsNotSatisfied() {
        stubMfa(1, 1);

        assertFalse(new MfaGuard(jdbc).satisfied("user", "workspace"));
    }

    @ParameterizedTest
    @MethodSource("tokenMfaValues")
    void bearerTokenRequiresTheAccountToHaveMfaEnabled(Integer enabled, boolean expected) {
        stubMfa(1, enabled);
        bindTokenRequest();

        assertEquals(expected, new MfaGuard(jdbc).satisfied("user", "workspace"));
    }

    @ParameterizedTest
    @MethodSource("sessionMfaValues")
    void sessionRequiresEnabledMfaAndVerification(
            Integer enabled,
            Boolean verified,
            boolean createSession,
            boolean expected) {
        stubMfa(1, enabled);
        bindSessionRequest(verified, createSession);

        assertEquals(expected, new MfaGuard(jdbc).satisfied("user", "workspace"));
    }

    @Test
    void requireSatisfiedReturnsWhenPredicateIsTrue() {
        stubMfa(0, null);

        new MfaGuard(jdbc).requireSatisfied("user", "workspace");
    }

    @Test
    void requireSatisfiedUsesTheMfaRequiredContractWhenPredicateIsFalse() {
        stubMfa(1, 1);

        ApiException error = assertThrows(ApiException.class,
            () -> new MfaGuard(jdbc).requireSatisfied("user", "workspace"));

        assertEquals(HttpStatus.FORBIDDEN, error.status());
        assertEquals("MFA_REQUIRED", error.code());
        assertTrue(error.getMessage().contains("multi-factor authentication"));
    }

    private void stubMfa(Integer required, Integer enabled) {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class)))
            .thenAnswer(invocation -> {
                String sql = invocation.getArgument(0);
                return sql.contains("require_mfa") ? required : enabled;
            });
    }

    private void bindTokenRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(AuthInterceptor.TOKEN_USER, "user");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private void bindSessionRequest(Boolean verified, boolean createSession) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (createSession) {
            MockHttpSession session = new MockHttpSession();
            if (verified != null) session.setAttribute(AuthInterceptor.MFA_VERIFIED, verified);
            request.setSession(session);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static Stream<Integer> notRequiredValues() {
        return Stream.of(null, 0);
    }

    private static Stream<Arguments> tokenMfaValues() {
        return Stream.of(
            Arguments.of(null, false),
            Arguments.of(0, false),
            Arguments.of(1, true)
        );
    }

    private static Stream<Arguments> sessionMfaValues() {
        return Stream.of(
            Arguments.of(null, null, false, false),
            Arguments.of(0, null, false, false),
            Arguments.of(1, null, false, false),
            Arguments.of(1, null, true, false),
            Arguments.of(1, false, true, false),
            Arguments.of(1, true, true, true)
        );
    }
}
