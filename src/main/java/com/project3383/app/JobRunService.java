package com.project3383.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

@Service
public class JobRunService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public JobRunService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> run(String name, Supplier<Map<String, Object>> work) {
        String id = UUID.randomUUID().toString();
        Instant started = Instant.now();
        jdbc.update("""
            INSERT INTO job_run (id, name, started_at, status) VALUES (?, ?, ?, 'running')
            """, id, name, started.toString());
        try {
            Map<String, Object> details = work.get();
            jdbc.update("""
                UPDATE job_run SET finished_at = ?, status = 'ok', details = ? WHERE id = ?
                """, Instant.now().toString(), json(details), id);
            return details;
        } catch (Exception exception) {
            jdbc.update("""
                UPDATE job_run SET finished_at = ?, status = 'failed', details = ? WHERE id = ?
                """, Instant.now().toString(), error(exception), id);
            throw exception;
        }
    }

    private String json(Map<String, Object> details) {
        try {
            return objectMapper.writeValueAsString(details == null ? Map.of() : details);
        } catch (Exception exception) {
            return "{}";
        }
    }

    private String error(Exception exception) {
        String message = exception.getMessage() == null ? exception.getClass().getSimpleName()
            : exception.getMessage();
        return message.length() > 2000 ? message.substring(0, 2000) : message;
    }
}
