package com.project3383;

import com.project3383.app.EmailDeliveryService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EmailDeliveryServiceTest {

    private ServerSocket server;
    private Thread smtpThread;

    @AfterEach
    void stopServer() throws Exception {
        if (server != null) server.close();
        if (smtpThread != null) smtpThread.join(2_000);
    }

    @Test
    void queuedEmailIsDeliveredOverSmtpAndMarkedSent() throws Exception {
        AtomicReference<String> delivered = new AtomicReference<>("");
        server = new ServerSocket(0);
        smtpThread = new Thread(() -> {
            try (Socket socket = server.accept();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(
                     socket.getInputStream(), StandardCharsets.UTF_8));
                 Writer writer = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8)) {
                writer.write("220 localhost Drift test SMTP\r\n");
                writer.flush();
                String line;
                boolean data = false;
                StringBuilder message = new StringBuilder();
                while ((line = reader.readLine()) != null) {
                    if (data) {
                        if (".".equals(line)) {
                            data = false;
                            delivered.set(message.toString());
                            writer.write("250 queued\r\n");
                            writer.flush();
                        } else {
                            message.append(line).append('\n');
                        }
                        continue;
                    }
                    String upper = line.toUpperCase();
                    if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
                        writer.write("250-localhost\r\n250 OK\r\n");
                    } else if (upper.startsWith("MAIL FROM") || upper.startsWith("RCPT TO")
                        || upper.startsWith("RSET") || upper.startsWith("NOOP")) {
                        writer.write("250 OK\r\n");
                    } else if (upper.startsWith("DATA")) {
                        data = true;
                        writer.write("354 End data with <CR><LF>.<CR><LF>\r\n");
                    } else if (upper.startsWith("QUIT")) {
                        writer.write("221 Bye\r\n");
                        writer.flush();
                        break;
                    } else {
                        writer.write("250 OK\r\n");
                    }
                    writer.flush();
                }
            } catch (Exception exception) {
                delivered.set("ERROR: " + exception.getMessage());
            }
        }, "smtp-test-server");
        smtpThread.start();

        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.sqlite.JDBC");
        dataSource.setUrl("jdbc:sqlite:target/test-email-" + System.nanoTime() + ".db");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
            CREATE TABLE email_message (
                id TEXT PRIMARY KEY, user_id TEXT, recipient TEXT NOT NULL, subject TEXT NOT NULL,
                body TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT,
                error TEXT, created_at TEXT NOT NULL
            )
            """);
        jdbc.update("""
            INSERT INTO email_message (id, user_id, recipient, subject, body, kind, status, created_at)
            VALUES ('mail-1', NULL, 'person@example.com', 'Your Drift day', 'A quiet summary.', 'digest', 'queued', ?)
            """, Instant.now().minusSeconds(120).toString());

        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost("127.0.0.1");
        sender.setPort(server.getLocalPort());
        sender.setDefaultEncoding("UTF-8");
        Properties properties = sender.getJavaMailProperties();
        properties.put("mail.smtp.auth", "false");
        properties.put("mail.smtp.starttls.enable", "false");
        properties.put("mail.smtp.ssl.enable", "false");
        properties.put("mail.smtp.connectiontimeout", "3000");
        properties.put("mail.smtp.timeout", "3000");

        @SuppressWarnings("unchecked")
        ObjectProvider<JavaMailSender> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(sender);
        EmailDeliveryService service = new EmailDeliveryService(
            jdbc, provider, "127.0.0.1", "drift@example.com");
        service.deliverQueuedEmail();

        String status = jdbc.queryForObject("SELECT status FROM email_message WHERE id = 'mail-1'", String.class);
        assumeTrue(delivered.get() != null);
        assertTrue(delivered.get().contains("Subject: Your Drift day"), delivered.get());
        assertTrue(delivered.get().contains("A quiet summary."), delivered.get());
        assertTrue("sent".equals(status), "Expected sent status, got " + status);
    }
}
