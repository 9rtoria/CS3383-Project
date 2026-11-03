package com.project3383;

import com.project3383.api.ApiException;
import com.project3383.auth.AuthInterceptor;
import com.project3383.auth.CurrentUser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CurrentUserTest {

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void sessionIdentityTakesPrecedenceOverBearerIdentity() {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(AuthInterceptor.SESSION_USER, "session-user");
        bindBearerUser("token-user");

        assertEquals("session-user", CurrentUser.id(session));
    }

    @Test
    void bearerIdentityIsUsedWhenSessionIsNull() {
        bindBearerUser(42);

        assertEquals("42", CurrentUser.id(null));
    }

    @Test
    void bearerIdentityIsUsedWhenSessionHasNoUser() {
        bindBearerUser("token-user");

        assertEquals("token-user", CurrentUser.id(new MockHttpSession()));
    }

    @Test
    void missingIdentityWithoutRequestContextIsUnauthorized() {
        ApiException error = assertThrows(ApiException.class, () -> CurrentUser.id(null));

        assertEquals(HttpStatus.UNAUTHORIZED, error.status());
        assertEquals("UNAUTHORIZED", error.code());
        assertEquals("No session.", error.getMessage());
    }

    @Test
    void missingIdentityInRequestContextIsUnauthorized() {
        RequestContextHolder.setRequestAttributes(
            new ServletRequestAttributes(new MockHttpServletRequest()));

        ApiException error = assertThrows(ApiException.class,
            () -> CurrentUser.id(new MockHttpSession()));

        assertEquals(HttpStatus.UNAUTHORIZED, error.status());
    }

    private void bindBearerUser(Object userId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(AuthInterceptor.TOKEN_USER, userId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }
}
