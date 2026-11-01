package com.project3383.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.project3383.api.ApiDtos;
import com.project3383.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class WebhookService {

    private static final Set<String> EVENTS = Set.of(
        "task.created", "task.moved", "task.completed", "task.deleted", "comment.created"
    );
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;
    private final MfaGuard mfaGuard;
    private final boolean allowPrivate;
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

    public WebhookService(
        JdbcTemplate jdbc,
        ObjectMapper objectMapper,
        AuditService auditService,
        MfaGuard mfaGuard,
        @Value("${project3383.webhook.allow-private:false}") boolean allowPrivate
    ) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
        this.mfaGuard = mfaGuard;
        this.allowPrivate = allowPrivate;
    }

    public Map<String, Object> list(String userId, String workspaceId) {
        requireAdmin(userId, workspaceId);
        List<Map<String, Object>> webhooks = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, kind, url, enabled, events_json AS eventsJson,
                   last_status AS lastStatus, last_delivery_at AS lastDeliveryAt,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM webhook WHERE workspace_id = ? ORDER BY created_at DESC
            """, workspaceId);
        Map<String, Integer> deliveryCounts = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("""
            SELECT webhook_id AS webhookId, COUNT(*) AS count
            FROM webhook_delivery WHERE webhook_id IN (
                SELECT id FROM webhook WHERE workspace_id = ?
            ) GROUP BY webhook_id
            """, workspaceId)) {
            deliveryCounts.put(String.valueOf(row.get("webhookId")), ((Number) row.get("count")).intValue());
        }
        for (Map<String, Object> webhook : webhooks) {
            webhook.put("enabled", number(webhook.get("enabled")) == 1);
            webhook.put("events", parseEvents(String.valueOf(webhook.remove("eventsJson"))));
            webhook.put("deliveries", deliveryCounts.getOrDefault(String.valueOf(webhook.get("id")), 0));
        }
        return linked(Map.of("webhooks", webhooks));
    }

    @Transactional
    public Map<String, Object> create(String userId, ApiDtos.WebhookCreate input) {
        if (input == null || input.workspaceId() == null) throw ApiException.badRequest("Choose a workspace.");
        requireAdmin(userId, input.workspaceId());
        String kind = normalizeKind(input.kind());
        String url = validateUrl(input.url());
        List<String> events = normalizeEvents(input.events());
        String id = UUID.randomUUID().toString();
        String now = Instant.now().toString();
        String secret = "whsec_" + randomToken();
        jdbc.update("""
            INSERT INTO webhook (id, workspace_id, kind, url, secret_enc, enabled, events_json,
                                 created_by, last_status, last_delivery_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, ?, ?)
            """, id, input.workspaceId(), kind, url, secret, json(events),
            userId, now, now);
        auditService.record(input.workspaceId(), userId, "webhook.created", "webhook", id,
            Map.of("kind", kind));
        Map<String, Object> webhook = webhookRow(id);
        webhook.put("secret", secret);
        webhook.put("events", events);
        return linked(Map.of("webhook", webhook));
    }

    @Transactional
    public Map<String, Object> update(String userId, String workspaceId, String webhookId, ApiDtos.WebhookUpdate input) {
        requireAdmin(userId, workspaceId);
        Map<String, Object> current = webhookRow(webhookId);
        if (!workspaceId.equals(current.get("workspaceId"))) throw ApiException.notFound("Webhook not found.");
        if (input == null) throw ApiException.badRequest("Webhook changes are required.");
        String kind = input.kind() == null ? String.valueOf(current.get("kind")) : normalizeKind(input.kind());
        String url = input.url() == null ? String.valueOf(current.get("url")) : validateUrl(input.url());
        boolean enabled = input.enabled() == null ? flag(current.get("enabled")) : input.enabled();
        List<String> events = input.events() == null
            ? currentEvents(current)
            : normalizeEvents(input.events());
        jdbc.update("""
            UPDATE webhook SET kind = ?, url = ?, enabled = ?, events_json = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ?
            """, kind, url, enabled ? 1 : 0, json(events),
            Instant.now().toString(), webhookId, workspaceId);
        auditService.record(workspaceId, userId, "webhook.updated", "webhook", webhookId, Map.of("enabled", enabled));
        Map<String, Object> webhook = webhookRow(webhookId);
        webhook.put("events", events);
        return linked(Map.of("webhook", webhook));
    }

    @Transactional
    public Map<String, Object> delete(String userId, String workspaceId, String webhookId) {
        requireAdmin(userId, workspaceId);
        int deleted = jdbc.update("DELETE FROM webhook WHERE id = ? AND workspace_id = ?", webhookId, workspaceId);
        if (deleted == 0) throw ApiException.notFound("Webhook not found.");
        auditService.record(workspaceId, userId, "webhook.deleted", "webhook", webhookId, Map.of());
        return linked(Map.of("deleted", true));
    }

    public void dispatch(String workspaceId, String event, Map<String, Object> data) {
        if (workspaceId == null || event == null) return;
        List<Map<String, Object>> hooks = jdbc.queryForList("""
            SELECT id, kind, url, secret_enc AS secret, events_json AS eventsJson
            FROM webhook WHERE workspace_id = ? AND enabled = 1
            """, workspaceId);
        for (Map<String, Object> hook : hooks) {
            if (!parseEvents(String.valueOf(hook.get("eventsJson"))).contains(event)) continue;
            String body;
            try {
                body = objectMapper.writeValueAsString(payloadFor(String.valueOf(hook.get("kind")), event, data));
            } catch (Exception exception) {
                body = "{\"event\":\"webhook.serialization_error\"}";
            }
            String deliveryId = UUID.randomUUID().toString();
            jdbc.update("""
                INSERT INTO webhook_delivery (id, webhook_id, event_type, payload_json, status,
                                              response, attempts, next_attempt_at, created_at)
                VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?)
                """, deliveryId, hook.get("id"), event, body,
                Instant.now().plusSeconds(60).toString(), Instant.now().toString());
            scheduleDelivery(deliveryId);
        }
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void retryDueDeliveries() {
        List<String> ids = jdbc.queryForList("""
            SELECT id FROM webhook_delivery
            WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= ? AND attempts < 3
            ORDER BY next_attempt_at LIMIT 20
            """, String.class, Instant.now().toString());
        for (String id : ids) {
            try {
                attemptDelivery(id);
            } catch (Exception ignored) {
                // The next scheduler tick retries.
            }
        }
    }

    private void scheduleDelivery(String deliveryId) {
        Runnable task = () -> {
            try {
                attemptDelivery(deliveryId);
            } catch (Exception exception) {
                // Leave the delivery due so the scheduler can retry it.
                try {
                    jdbc.update("""
                        UPDATE webhook_delivery SET next_attempt_at = ? WHERE id = ? AND status IS NULL
                        """, Instant.now().plusSeconds(300).toString(), deliveryId);
                } catch (Exception ignored) {
                    // A later scheduler tick or process restart will pick it up.
                }
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    java.util.concurrent.CompletableFuture.runAsync(task);
                }
            });
        } else {
            java.util.concurrent.CompletableFuture.runAsync(task);
        }
    }

    public void attemptDelivery(String deliveryId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT d.id, d.webhook_id AS webhookId, d.event_type AS eventType,
                   d.payload_json AS payload, d.attempts, d.next_attempt_at AS nextAttemptAt,
                   w.enabled, w.url, w.secret_enc AS secret
            FROM webhook_delivery d LEFT JOIN webhook w ON w.id = d.webhook_id
            WHERE d.id = ?
            """, deliveryId);
        if (rows.isEmpty()) return;
        Map<String, Object> delivery = rows.get(0);
        if (delivery.get("url") == null || number(delivery.get("enabled")) == 0) {
            jdbc.update("""
                UPDATE webhook_delivery SET response = ?, next_attempt_at = NULL WHERE id = ?
                """, delivery.get("url") == null ? "Webhook no longer exists" : "Webhook disabled before delivery",
                deliveryId);
            return;
        }
        int status = 0;
        String response = "";
        boolean success = false;
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(String.valueOf(delivery.get("url"))))
                .timeout(Duration.ofSeconds(5))
                .header("content-type", "application/json")
                .header("user-agent", "Drift-Webhook/1.0")
                .header("x-drift-event", String.valueOf(delivery.get("eventType")))
                .POST(HttpRequest.BodyPublishers.ofString(String.valueOf(delivery.get("payload"))));
            String secret = delivery.get("secret") == null ? null : String.valueOf(delivery.get("secret"));
            if (secret != null && !secret.isBlank()) {
                request.header("x-drift-signature", "sha256=" + hmac(secret, String.valueOf(delivery.get("payload"))));
            }
            HttpResponse<String> result = httpClient.send(request.build(), HttpResponse.BodyHandlers.ofString());
            status = result.statusCode();
            response = result.body() == null ? "" : result.body();
            success = status >= 200 && status < 300;
        } catch (Exception exception) {
            response = exception.getMessage() == null ? "Delivery failed" : exception.getMessage();
            status = 0;
        }
        int attempts = number(delivery.get("attempts")) + 1;
        String nextAttempt = success || attempts >= 3
            ? null
            : Instant.now().plusSeconds(retryDelaySeconds(attempts)).toString();
        String clipped = response.length() > 1000 ? response.substring(0, 1000) : response;
        jdbc.update("""
            UPDATE webhook_delivery SET status = ?, response = ?, attempts = ?, next_attempt_at = ?
            WHERE id = ?
            """, status == 0 ? null : status, clipped, attempts, nextAttempt, deliveryId);
        jdbc.update("""
            UPDATE webhook SET last_status = ?, last_delivery_at = ?, updated_at = ?
            WHERE id = ?
            """, status == 0 ? null : status, Instant.now().toString(), Instant.now().toString(),
            delivery.get("webhookId"));
    }

    private Map<String, Object> webhookRow(String id) {
        Map<String, Object> row = jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId, kind, url, enabled, events_json AS eventsJson,
                   last_status AS lastStatus, last_delivery_at AS lastDeliveryAt,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM webhook WHERE id = ?
            """, id).stream().findFirst().orElseThrow(() -> ApiException.notFound("Webhook not found."));
        row.put("enabled", number(row.get("enabled")) == 1);
        row.put("events", parseEvents(String.valueOf(row.remove("eventsJson"))));
        return row;
    }

    private List<String> currentEvents(Map<String, Object> row) {
        Object events = row.get("events");
        if (!(events instanceof List<?> values)) return List.of();
        List<String> result = new ArrayList<>();
        for (Object value : values) if (value != null) result.add(String.valueOf(value));
        return result;
    }

    private String normalizeKind(String kind) {
        String value = kind == null ? "slack" : kind.trim().toLowerCase();
        if (!Set.of("slack", "teams", "generic").contains(value)) {
            throw ApiException.badRequest("Webhook kind must be slack, teams, or generic.");
        }
        return value;
    }

    private List<String> normalizeEvents(List<String> events) {
        List<String> normalized = events == null ? List.of() : events.stream()
            .filter(event -> event != null && EVENTS.contains(event))
            .distinct()
            .toList();
        if (normalized.isEmpty()) throw ApiException.badRequest("Choose at least one webhook event.");
        return normalized;
    }

    private List<String> parseEvents(String json) {
        try {
            List<?> values = objectMapper.readValue(json, List.class);
            List<String> events = new ArrayList<>();
            for (Object value : values) if (value != null) events.add(String.valueOf(value));
            return events;
        } catch (Exception exception) {
            return List.of();
        }
    }

    private String validateUrl(String value) {
        if (value == null || value.isBlank()) throw ApiException.badRequest("Webhook URL is required.");
        URI uri;
        try {
            uri = URI.create(value.trim());
        } catch (Exception exception) {
            throw ApiException.badRequest("Enter a valid webhook URL.");
        }
        if (uri.getHost() == null || uri.getUserInfo() != null) throw ApiException.badRequest("Enter a valid webhook URL.");
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"https".equals(scheme) && !(allowPrivate && "http".equals(scheme))) {
            throw ApiException.badRequest("Use an HTTPS webhook URL.");
        }
        if (!allowPrivate) {
            try {
                for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                    if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress() || address.isMulticastAddress()) {
                        throw ApiException.badRequest("Webhook URL cannot target a private address.");
                    }
                }
            } catch (ApiException exception) {
                throw exception;
            } catch (Exception exception) {
                throw ApiException.badRequest("Webhook host could not be resolved.");
            }
        }
        return uri.toString();
    }

    private String payloadFor(String kind, String event, Map<String, Object> data) {
        String title = data != null && data.get("title") != null ? String.valueOf(data.get("title")) : "Task activity";
        if ("teams".equals(kind)) {
            return "{\"type\":\"message\",\"attachments\":[{\"contentType\":\"application/vnd.microsoft.card.adaptive\","
                + "\"content\":{\"$schema\":\"http://adaptivecards.io/schemas/adaptive-card.json\","
                + "\"type\":\"AdaptiveCard\",\"version\":\"1.4\",\"body\":["
                + "{\"type\":\"TextBlock\",\"weight\":\"Bolder\",\"text\":\"Drift · " + escape(event.replace('.', ' ')) + "\"},"
                + "{\"type\":\"TextBlock\",\"text\":\"" + escape(title) + "\",\"wrap\":true}]}}]}";
        }
        if ("generic".equals(kind)) {
            try {
                return objectMapper.writeValueAsString(Map.of("event", event, "data", data == null ? Map.of() : data, "source", "drift"));
            } catch (Exception exception) {
                return "{\"event\":\"" + escape(event) + "\",\"source\":\"drift\"}";
            }
        }
        return "{\"text\":\"*Drift · " + escape(event.replace('.', ' ')) + "*\\n" + escape(title) + "\"}";
    }

    private String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            return "[]";
        }
    }

    private String hmac(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            return "";
        }
    }

    private long retryDelaySeconds(int attempts) {
        return switch (Math.min(attempts, 3)) {
            case 1 -> 5 * 60L;
            case 2 -> 15 * 60L;
            default -> 45 * 60L;
        };
    }

    private String randomToken() {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private void requireAdmin(String userId, String workspaceId) {
        String role = jdbc.queryForList("""
            SELECT m.role FROM membership m JOIN workspace w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND m.workspace_id = ? AND w.deleted_at IS NULL
            """, userId, workspaceId).stream().findFirst()
            .map(row -> String.valueOf(row.get("role")))
            .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        if (!"OWNER".equals(role) && !"ADMIN".equals(role)) {
            throw ApiException.forbidden("You do not have permission to manage webhooks.");
        }
        mfaGuard.requireSatisfied(userId, workspaceId);
    }

    private int number(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private boolean flag(Object value) {
        return value instanceof Boolean bool ? bool : number(value) == 1;
    }

    private Map<String, Object> linked(Map<String, Object> value) {
        return new LinkedHashMap<>(value);
    }
}
