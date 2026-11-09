# SD15 — Notifications & Reminder Delivery

**Covers:** `NotificationController.list / mark / read / readAll`;
`NotificationService.notify / list / mark / markRead / markAllRead`;
`ReminderScheduler.deliverDueReminders` (time-triggered).

Source: `api/NotificationController.java`, `app/NotificationService.java`,
`app/ReminderScheduler.java`.

The browser **polls** `GET /api/notifications` (via `NotificationController`) to fetch notifications
— the request flows downward, it is not a push from the service. The PATCH flows (mark one / all
read) also pass through the controller. The reminder half is driven by the scheduler (a found
message from the clock).

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :NotificationController
    participant N as :NotificationService
    participant DB as :JdbcTemplate
    participant RS as :ReminderScheduler
    actor T as :Clock

    Note over U,DB: notify(...) — called by task/automation/reminder flows
    N->>DB: SELECT membership (user in workspace?)
    alt not a member
        N-->>N: return null
    end
    N->>DB: SELECT user_settings.notifications_json
    Note over N: rules: inApp / mentions
    alt inApp=false or mention muted
        N-->>N: return null
    end
    N->>DB: INSERT notification(read_at=NULL)

    Note over U,DB: polling — GET /api/notifications
    U->>B: app refresh / interval
    B->>C: GET /api/notifications
    C->>N: list(userId)
    N->>DB: SELECT notification WHERE user_id AND membership (ORDER BY created_at DESC LIMIT 50)
    N-->>C: {notifications[], unreadCount}
    C-->>B: notifications JSON
    B-->>U: render notification list

    Note over T,DB: every 30s — ReminderScheduler.deliverDueReminders
    T->>RS: scheduled tick
    RS->>DB: SELECT due reminders (open task, member sees board)
    loop for each due reminder
        RS->>DB: UPDATE reminder SET sent_at=now WHERE sent_at IS NULL
        alt claim succeeded (claimed=1)
            RS->>N: notify(userId, "reminder", "Reminder: title", link)
            N->>DB: INSERT notification
        else already sent
            Note over RS: skip
        end
    end

    Note over U,DB: PATCH /api/notifications  (or /{id}/read, /read-all)
    U->>B: mark one / all read
    B->>C: PATCH /api/notifications {all, read, id}
    C->>N: mark(userId, all, read, id)
    alt read != true
        N-->>C: {updated:0} (no update)
    else read = true
        N->>DB: UPDATE notification SET read_at
        N-->>C: updated list + {updated}
    end
    C-->>B: notifications JSON
    B-->>U: unread count cleared
```
