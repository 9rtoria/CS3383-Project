package com.project3383;

import com.project3383.api.ApiException;
import java.util.function.Function;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpStatus;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ApiExceptionTest {

    @Test
    void constructorPreservesStatusCodeAndMessage() {
        ApiException error = new ApiException(HttpStatus.I_AM_A_TEAPOT, "TEAPOT", "Short and stout");

        assertEquals(HttpStatus.I_AM_A_TEAPOT, error.status());
        assertEquals("TEAPOT", error.code());
        assertEquals("Short and stout", error.getMessage());
    }

    @ParameterizedTest
    @MethodSource("simpleFactories")
    void simpleFactoriesUseTheirDocumentedContracts(
            Function<String, ApiException> factory,
            HttpStatus status,
            String code) {
        ApiException error = factory.apply("message");

        assertEquals(status, error.status());
        assertEquals(code, error.code());
        assertEquals("message", error.getMessage());
    }

    @Test
    void conflictIncludesTheCurrentVersion() {
        ApiException error = ApiException.conflict("Stale task", 17);

        assertEquals(HttpStatus.CONFLICT, error.status());
        assertEquals("VERSION_CONFLICT", error.code());
        assertEquals("Stale task (current version: 17)", error.getMessage());
    }

    private static Stream<Arguments> simpleFactories() {
        return Stream.of(
            Arguments.of((Function<String, ApiException>) ApiException::notFound,
                HttpStatus.NOT_FOUND, "NOT_FOUND"),
            Arguments.of((Function<String, ApiException>) ApiException::badRequest,
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR"),
            Arguments.of((Function<String, ApiException>) ApiException::forbidden,
                HttpStatus.FORBIDDEN, "FORBIDDEN"),
            Arguments.of((Function<String, ApiException>) ApiException::wipLimit,
                HttpStatus.CONFLICT, "WIP_LIMIT"),
            Arguments.of((Function<String, ApiException>) ApiException::dependencyBlocked,
                HttpStatus.CONFLICT, "DEPENDENCY_BLOCKED")
        );
    }
}
