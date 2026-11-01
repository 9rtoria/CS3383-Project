package com.project3383.app;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Component
public class EmailDeliveryService {

    private final JdbcTemplate jdbc;
    private final ObjectProvider<JavaMailSender> mailSender;
    private final String host;
    private final String from;

    public EmailDeliveryService(JdbcTemplate jdbc, ObjectProvider<JavaMailSender> mailSender,
                                @Value("${spring.mail.host:}") String host,
                                @Value("${spring.mail.username:}") String from) {
        this.jdbc = jdbc;
        this.mailSender = mailSender;
        this.host = host;
        this.from = from;
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 15_000)
    public void deliverQueuedEmail() {
        if (host == null || host.isBlank()) return;
        JavaMailSender sender = mailSender.getIfAvailable();
        if (sender == null) return;
        List<Map<String, Object>> messages = jdbc.queryForList("""
            SELECT id, recipient, subject, body FROM email_message
            WHERE status IN ('queued', 'failed') AND created_at < ?
            ORDER BY created_at LIMIT 20
            """, Instant.now().minusSeconds(60).toString());
        for (Map<String, Object> message : messages) {
            try {
                SimpleMailMessage mail = new SimpleMailMessage();
                mail.setTo(String.valueOf(message.get("recipient")));
                mail.setSubject(String.valueOf(message.get("subject")));
                mail.setText(String.valueOf(message.get("body")));
                if (from != null && !from.isBlank()) mail.setFrom(from);
                sender.send(mail);
                jdbc.update("""
                    UPDATE email_message SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?
                    """, Instant.now().toString(), message.get("id"));
            } catch (Exception exception) {
                String error = exception.getMessage() == null ? exception.getClass().getSimpleName()
                    : exception.getMessage();
                if (error.length() > 1000) error = error.substring(0, 1000);
                jdbc.update("""
                    UPDATE email_message SET status = 'failed', error = ? WHERE id = ?
                    """, error, message.get("id"));
            }
        }
    }
}
