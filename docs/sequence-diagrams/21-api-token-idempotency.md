# SD21 —API-token Auth & Idempotent Replay (interceptors)

**Covers:** `AuthInterceptor.preHandle` (Bearer token / session / CSRF),
`ApiTokenService.authenticate`, `IdempotencyInterceptor.preHandle`,
`IdempotencyResponseAdvice.beforeBodyWrite`.

Source: `auth/AuthInterceptor.java`, `api/IdempotencyInterceptor.java`,
`api/IdempotencyResponseAdvice.java`.

This is the cross-cutting pipeline that every `/api/**` request passes through. Two independent
`alt`/`break` decisions: (1) is the caller authenticated & CSRF-clean? (2) is this an
idempotency-key replay?

```mermaid
sequenceDiagram
    autonumber
    actor U as :Client
    participant F as :FilterChain
    participant AI as :AuthInterceptor
    participant AT as :ApiTokenService
    participant II as :IdempotencyInterceptor
    participant C as :Controller
    participant IDA as :IdempotencyResponseAdvice
    participant DB as :JdbcTemplate

    U->>F: request (Authorization: Bearer drift_pat_.. or session cookie)
    F->>AI: preHandle

    alt Authorization Bearer
        AI->>AT: authenticate(raw)
        AT->>DB: SELECT api_token WHERE token_hash
        alt invalid / expired / revoked
            AI-->>F: 401 UNAUTHORIZED (write JSON)
        else valid
            AT->>DB: UPDATE last_used_at
            AT-->>AI: {userId, workspaceId}
            AI->>AI: set TOKEN_USER/TOKEN_WORKSPACE
            opt request workspaceId (header X-Workspace-Id or ?workspaceId) differs from token scope
                AI-->>F: 403 FORBIDDEN scoped
            end
            Note over AI: valid token → return true (no session/CSRF checks)
        end
    else session cookie
        AI->>AI: session.getAttribute(SESSION_USER)
        alt no session user
            AI-->>F: 401 "Create a guest session first"
        end
        opt mutating method (not GET/HEAD/OPTIONS)
            AI->>AI: check Origin / Sec-Fetch-Site vs expected
            F-->>F: [cross-site] 403 CSRF_REJECTED
        end
        AI->>AI: sessionService.touch(session,userId)
        alt expired / revoked
            AI->>AI: session.invalidate()
            AI-->>F: 401 UNAUTHORIZED
        end
    end
    AI-->>F: proceed
    F->>II: preHandle
    II->>II: read Idempotency-Key header (skip GET/HEAD/OPTIONS/blank/>200 chars/unauthenticated)
    alt key present & authenticated
        II->>DB: SELECT idempotency_key WHERE user & key
        alt exists
            alt method/path differ
                II-->>F: 409 CONFLICT (key reused for other request)
            else not expired
                II-->>F: replay stored status+body (Idempotent-Replayed)
            else expired
                II->>DB: DELETE expired key —continue
            end
        end
    end
    II-->>F: proceed
    F->>C: controller handler runs
    C-->>IDA: response body
    IDA->>IDA: if key present & status < 400
    IDA->>DB: INSERT idempotency_key(response_json, expires=+24h) ON CONFLICT DO NOTHING
    IDA-->>U: response
```
