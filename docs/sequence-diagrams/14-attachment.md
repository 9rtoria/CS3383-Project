# SD14 —Attachment Upload / Download / Delete

**Covers:** `AttachmentController.upload / download / delete` —`AttachmentService.upload / download / delete`.

Source: `app/AttachmentService.java`.

File I/O is an extra participant (`:FileSystem`) that only `AttachmentService` talks to. The
service checks MIME allowlist, size (10 MB) and workspace attachment policy before writing.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :AttachmentController
    participant A as :AttachmentService
    participant FS as :FileSystem(data/attachments)
    participant DB as :JdbcTemplate

    Note over U,DB: POST /api/tasks/{id}/attachments  (multipart)
    U->>B: choose file
    B->>C: upload(taskId, file)
    C->>A: upload(userId, taskId, file)
    A->>A: file not empty & size <= 10MB
    A->>A: ALLOWED.contains(mimeType)?
    A-->>A: [not allowed] throw 400
    A->>DB: SELECT task (workspace, board visibility)
    A->>A: requireTaskAccess(userId, task, write=true)
    A->>DB: SELECT workspace.attachments_enabled
    A-->>A: [disabled] throw 403
    A->>A: sanitizeName, storageName = UUID + ext
    A->>FS: Files.copy(inputStream, target)
    alt IOException
        A->>FS: Files.deleteIfExists(target)
        A-->>C: throw IllegalStateException (default 500, not {code,message} envelope)
    end
    A->>DB: INSERT attachment(name, storage_name, mime, size)
    A->>DB: INSERT activity_event("attachment.created")
    A-->>C: {attachment}
    C-->>B: 200 JSON

    Note over U,DB: GET /api/attachments/{id}
    B->>C: download(id)
    C->>A: download(userId, id)
    A->>DB: SELECT attachment JOIN task JOIN board
    A->>A: requireTaskAccess(userId, row, write=false)
    A->>FS: resolve path, exists?
    A-->>A: [missing] throw 404
    A-->>C: AttachmentFile(FileSystemResource, name, mediaType)
    C-->>B: stream file (Content-Disposition: attachment)

    Note over U,DB: DELETE /api/attachments/{id}
    B->>C: delete(id)
    C->>A: delete(userId, id)
    A->>A: requireTaskAccess(write=true)
    A->>DB: UPDATE attachment SET deleted_at=now
    A->>DB: INSERT activity_event("attachment.deleted")
    A->>FS: Files.deleteIfExists(storageName)
    A-->>C: {deleted:true}
```
