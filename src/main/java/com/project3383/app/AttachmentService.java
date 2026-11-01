package com.project3383.app;

import com.project3383.api.ApiException;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class AttachmentService {

    private static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final Set<String> ALLOWED = Set.of(
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
        "application/pdf", "text/plain", "text/csv", "text/markdown",
        "application/json", "application/zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );

    private final JdbcTemplate jdbc;
    private final Path directory;

    public AttachmentService(
        JdbcTemplate jdbc,
        @Value("${project3383.attachment-dir:data/attachments}") String directory
    ) {
        this.jdbc = jdbc;
        this.directory = Path.of(directory).toAbsolutePath().normalize();
    }

    @PostConstruct
    void initialize() throws IOException {
        Files.createDirectories(directory);
    }

    public Map<String, Object> upload(String userId, String taskId, MultipartFile file) {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("Choose a file to upload.");
        if (file.getSize() > MAX_BYTES) throw ApiException.badRequest("Files must be 10 MB or smaller.");
        String mimeType = file.getContentType() == null ? "application/octet-stream" : file.getContentType();
        if (!ALLOWED.contains(mimeType)) throw ApiException.badRequest("That file type is not allowed.");
        Map<String, Object> task = task(taskId);
        requireMember(userId, (String) task.get("workspaceId"));

        String original = sanitizeName(file.getOriginalFilename());
        String extension = "";
        int dot = original.lastIndexOf('.');
        if (dot >= 0) extension = original.substring(dot).replaceAll("[^.a-zA-Z0-9]", "").substring(0, Math.min(12, original.substring(dot).length()));
        String storageName = UUID.randomUUID() + extension;
        Path target = directory.resolve(storageName).normalize();
        if (!target.startsWith(directory)) throw ApiException.badRequest("Invalid file name.");
        try {
            Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
            String id = UUID.randomUUID().toString();
            jdbc.update("""
                INSERT INTO attachment (id, task_id, uploader_id, name, storage_name, mime_type, size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, id, taskId, userId, original, storageName, mimeType, file.getSize(), Instant.now().toString());
            return Map.of("attachment", attachment(id));
        } catch (IOException exception) {
            try { Files.deleteIfExists(target); } catch (IOException ignored) { }
            throw new IllegalStateException("Could not store attachment.", exception);
        }
    }

    public AttachmentFile download(String userId, String attachmentId) {
        Map<String, Object> row = jdbc.queryForList("""
            SELECT a.id, a.task_id AS taskId, a.name, a.storage_name AS storageName,
                   a.mime_type AS mimeType, t.workspace_id AS workspaceId
            FROM attachment a JOIN task t ON t.id = a.task_id
            WHERE a.id = ? AND a.deleted_at IS NULL AND t.deleted_at IS NULL
            """, attachmentId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Attachment not found."));
        requireMembership(userId, (String) row.get("workspaceId"));
        Path path = directory.resolve((String) row.get("storageName")).normalize();
        if (!path.startsWith(directory) || !Files.exists(path)) throw ApiException.notFound("Attachment file not found.");
        String mimeType = (String) row.get("mimeType");
        MediaType mediaType;
        try { mediaType = MediaType.parseMediaType(mimeType); }
        catch (Exception exception) { mediaType = MediaType.APPLICATION_OCTET_STREAM; }
        return new AttachmentFile(
            new FileSystemResource(path),
            row.get("name").toString(),
            mediaType,
            ContentDisposition.attachment().filename(row.get("name").toString(), StandardCharsets.UTF_8).build().toString()
        );
    }

    public Map<String, Object> delete(String userId, String attachmentId) {
        Map<String, Object> row = jdbc.queryForList("""
            SELECT a.id, a.storage_name AS storageName, t.workspace_id AS workspaceId
            FROM attachment a JOIN task t ON t.id = a.task_id
            WHERE a.id = ? AND a.deleted_at IS NULL
            """, attachmentId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Attachment not found."));
        requireMember(userId, (String) row.get("workspaceId"));
        jdbc.update("UPDATE attachment SET deleted_at = ? WHERE id = ?", Instant.now().toString(), attachmentId);
        try { Files.deleteIfExists(directory.resolve((String) row.get("storageName"))); } catch (IOException ignored) { }
        return Map.of("deleted", true);
    }

    private Map<String, Object> attachment(String id) {
        return jdbc.queryForList("""
            SELECT id, name, mime_type AS mimeType, size, created_at AS createdAt
            FROM attachment WHERE id = ?
            """, id).stream().findFirst().orElseThrow();
    }

    private Map<String, Object> task(String taskId) {
        return jdbc.queryForList("""
            SELECT id, workspace_id AS workspaceId FROM task WHERE id = ? AND deleted_at IS NULL
            """, taskId).stream().findFirst()
            .orElseThrow(() -> ApiException.notFound("Task not found."));
    }

    private void requireMembership(String userId, String workspaceId) {
        Integer count = jdbc.queryForObject("""
            SELECT COUNT(*) FROM membership WHERE user_id = ? AND workspace_id = ?
            """, Integer.class, userId, workspaceId);
        if (count == null || count == 0) throw ApiException.notFound("Task not found.");
    }

    private void requireMember(String userId, String workspaceId) {
        String role = jdbc.queryForList("""
            SELECT role FROM membership WHERE user_id = ? AND workspace_id = ?
            """, userId, workspaceId).stream().findFirst()
            .map(row -> row.get("role").toString())
            .orElseThrow(() -> ApiException.notFound("Task not found."));
        if ("GUEST".equals(role)) throw ApiException.forbidden("You do not have permission for this action.");
    }

    private String sanitizeName(String name) {
        String value = name == null || name.isBlank() ? "attachment" : Path.of(name).getFileName().toString();
        value = value.replaceAll("[\\r\\n\\t]", "").trim();
        if (value.isEmpty()) value = "attachment";
        return value.length() > 180 ? value.substring(0, 180) : value;
    }

    public record AttachmentFile(Resource resource, String filename, MediaType mediaType, String contentDisposition) {
    }
}
