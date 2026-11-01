package com.project3383.api;

import com.project3383.app.AttachmentService;
import com.project3383.auth.CurrentUser;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class AttachmentController {

    private final AttachmentService attachmentService;

    public AttachmentController(AttachmentService attachmentService) {
        this.attachmentService = attachmentService;
    }

    @PostMapping("/tasks/{taskId}/attachments")
    public Map<String, Object> upload(
        HttpSession session,
        @PathVariable String taskId,
        @RequestPart("file") MultipartFile file
    ) {
        return attachmentService.upload(CurrentUser.id(session), taskId, file);
    }

    @GetMapping("/attachments/{id}")
    public ResponseEntity<Resource> download(HttpSession session, @PathVariable String id) {
        AttachmentService.AttachmentFile file = attachmentService.download(CurrentUser.id(session), id);
        return ResponseEntity.ok()
            .contentType(file.mediaType())
            .header(HttpHeaders.CONTENT_DISPOSITION, file.contentDisposition())
            .header("X-Content-Type-Options", "nosniff")
            .cacheControl(CacheControl.noStore())
            .body(file.resource());
    }

    @DeleteMapping("/attachments/{id}")
    public Map<String, Object> delete(HttpSession session, @PathVariable String id) {
        return attachmentService.delete(CurrentUser.id(session), id);
    }
}
