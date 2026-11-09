# SD16 — Webhook Dispatch (synchronous) + Asynchronous Delivery & Retry

**Covers:** `WebhookService.dispatch / scheduleDelivery / attemptDelivery / retryDueDeliveries`.

Source: `app/WebhookService.java` (`dispatch` at :149, `@Scheduled retryDueDeliveries` at :174,
`attemptDelivery` uses blocking `HttpClient.send()`).

`dispatch()` itself is **synchronous**: it runs on the caller's thread, queries matching hooks,
inserts `webhook_delivery` rows, and returns. Only the actual delivery (`attemptDelivery`) is
scheduled onto a background thread via `CompletableFuture.runAsync` (after the transaction
commits). The HTTP call is a **blocking** `httpClient.send()` even though it runs on that
background thread. There is **no separate scheduler class** — the `@Scheduled` retry method lives
inside `WebhookService`. Backoff is 5 min → 15 min → 45 min (attempts 1/2/3).

```mermaid
sequenceDiagram
    autonumber
    participant A as :AppService
    participant W as :WebhookService
    participant DB as :JdbcTemplate
    participant EX as :Executor(thread)
    participant R as :RemoteEndpoint

    Note over A,W: synchronous part — runs on the caller's thread
    A->>W: dispatch(workspace, event, data)
    W->>DB: SELECT webhook WHERE workspace & enabled
    loop for each matching hook
        W->>W: payloadFor(kind, event, data) → JSON
        W->>DB: INSERT webhook_delivery(status=NULL, attempts=0, next_attempt_at=+60s)
        W->>W: scheduleDelivery(deliveryId)
        alt transaction active
            W->>W: registerSynchronization.afterCommit → runAsync(attempt)
        else no transaction
            W->>W: CompletableFuture.runAsync(attempt)
        end
    end
    W-->>A: dispatch returns (no delivery done yet)

    Note over EX,R: asynchronous delivery — background thread
    EX->>W: attemptDelivery(deliveryId)
    W->>DB: SELECT delivery JOIN webhook
    alt webhook gone / disabled
        W->>DB: UPDATE webhook_delivery SET response, next_attempt_at=NULL
    else deliver
        W->>W: decrypt secret, sign HMAC
        W->>R: httpClient.send(POST JSON)  — blocking call
        R-->>W: HTTP status + body
        W->>DB: UPDATE delivery SET status, response, attempts, next_attempt_at
        W->>DB: UPDATE webhook SET last_status, last_delivery_at
    end

    Note over W,R: every 60s — @Scheduled retryDueDeliveries (inside WebhookService)
    W->>DB: SELECT deliveries due & attempts < 3 (limit 20)
    loop each due delivery
        W->>W: attemptDelivery(id)
        Note over W: backoff attempt1=+5min, attempt2=+15min, attempt3=+45min
    end
```
