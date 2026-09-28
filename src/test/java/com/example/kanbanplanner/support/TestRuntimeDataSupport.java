package com.example.kanbanplanner.support;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileSystemException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public final class TestRuntimeDataSupport {

    private static final String SEED_RESOURCE_PATH = "data/seed-data.json";
    private static final int RESET_RETRY_ATTEMPTS = 8;
    private static final long RESET_RETRY_DELAY_MILLIS = 40L;

    private TestRuntimeDataSupport() {
    }

    public static void resetRuntimeData(Path runtimePath) throws IOException {
        Path parent = runtimePath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        FileSystemException lastFailure = null;

        for (int attempt = 1; attempt <= RESET_RETRY_ATTEMPTS; attempt++) {
            try (InputStream inputStream = Thread.currentThread()
                    .getContextClassLoader()
                    .getResourceAsStream(SEED_RESOURCE_PATH)) {
                if (inputStream == null) {
                    throw new IllegalStateException("Missing seed data resource: " + SEED_RESOURCE_PATH);
                }

                Files.copy(inputStream, runtimePath, StandardCopyOption.REPLACE_EXISTING);
                return;
            } catch (FileSystemException exception) {
                lastFailure = exception;
                if (attempt == RESET_RETRY_ATTEMPTS) {
                    throw exception;
                }
                sleepBeforeRetry(attempt, exception);
            }
        }

        if (lastFailure != null) {
            throw lastFailure;
        }
    }

    private static void sleepBeforeRetry(int attempt, FileSystemException cause) throws IOException {
        try {
            Thread.sleep(RESET_RETRY_DELAY_MILLIS * attempt);
        } catch (InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
            IOException wrapped = new IOException("Interrupted while retrying runtime test data reset", interruptedException);
            wrapped.addSuppressed(cause);
            throw wrapped;
        }
    }
}
