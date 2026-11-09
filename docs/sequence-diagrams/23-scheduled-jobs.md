# SD23 — Scheduled Background Jobs

**Covers:** `DigestScheduler.queueDailyDigests`, `RetentionScheduler.purgeExpiredContent`
(housekeeping + retention), `EmailDeliveryService.deliverQueuedEmail`
(`ReminderScheduler` is covered in SD15). All driven by `@Scheduled` (found messages from
`:Clock`). The digest and retention jobs are wrapped with `JobRunService.run` for run history;
`EmailDeliveryService` is **not** (no `JobRunService` call).

Source: `app/DigestScheduler.java`, `app/RetentionScheduler.java`, `app/EmailDeliveryService.java`.

`JavaMailSender.send()` is a **blocking** call (not an asynchronous request). The SMTP
guard (`host` blank or no `JavaMailSender` bean) is checked **before** querying queued messages.

```mermaid
sequenceDiagram
    autonumber
    actor T as :Clock
    participant DS as :DigestScheduler
    participant RS as :RetentionScheduler
    participant ES as :EmailDeliveryService
    participant JR as :JobRunService
    participant DB as :JdbcTemplate
    participant SMTP as :SMTPServer

    Note over T,SMTP: hourly — queueDailyDigests
    T->>DS: tick
    DS->>JR: run("daily-digests", this::digests)
    DS->>DB: SELECT users with email_digest=1
    loop for each user in their timezone
        Note over DS: [now.hour != digest_hour] skip (in Java)
        Note over DS: [quiet hours] skip, [digest sent < 20h] skip
        DS->>DB: SELECT today's/overdue tasks visible to user
        DS->>DB: INSERT email_message(kind='digest', status='queued')
    end
    DS-->>JR: details

    Note over T,SMTP: every 6h — purgeExpiredContent
    T->>RS: tick
    RS->>JR: run("housekeeping", this::housekeeping)
    RS->>DB: DELETE expired sessions/magic links/idempotency/undo/webhook_delivery + email_message(sent/failed/preview) + client_error
    RS->>JR: run("retention", this::retention)
    loop for each workspace
        RS->>DB: UPDATE archived tasks past retention → deleted_at
        RS->>DB: DELETE audit events past audit_retention_days
    end

    Note over T,SMTP: every 30s — deliverQueuedEmail
    T->>ES: tick
    alt host blank or no JavaMailSender bean
        ES-->>T: return (checked before query)
    else SMTP configured
        ES->>DB: SELECT email_message queued/failed(<5) older than 60s
        loop for each message
            ES->>SMTP: sender.send(SimpleMailMessage)  — blocking call
            SMTP-->>ES: ok
            alt send succeeded
                ES->>DB: UPDATE email_message SET status='sent'
            else send throws
                ES->>DB: UPDATE status='failed', attempts+1, error
            end
        end
    end
```
