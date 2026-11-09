# SD03 —Passwordless Magic-link Sign-in

**Covers:** `AuthController.magic / verifyMagic / throttleMagicLink`,
`AppService.requestMagicLink / loginWithMagicToken`, `SessionService.start`.

Source: `api/AuthController.java`, `app/AppService.java`.

Throttling is a `break` (rate limit exits early). Token claim is guarded by an atomic
`UPDATE ... WHERE used_at IS NULL AND expires_at > now`; a lost claim throws `INVALID_TOKEN`.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :AuthController
    participant A as :AppService
    participant M as :MfaService
    participant S as :SessionService
    participant DB as :JdbcTemplate

    Note over U,DB: POST /api/auth/magic
    U->>B: enter email
    B->>C: magic(request, session, {email, next})
    C->>C: throttleMagicLink(email, ip)
    break >= 5 attempts in 15 min
        C-->>B: 429 RATE_LIMITED
    end
    C->>A: requestMagicLink(email, ip, next, state, baseUrl)
    A->>A: token = randomToken()
    A->>DB: INSERT magic_link_token(token_hash, expires=+15m)
    A->>DB: INSERT email_message(kind='magic', status='queued')
    A-->>C: MagicLink(token, devUrl)
    C->>C: session[magic.state] = state
    C-->>B: {sent:true, devUrl?}

    Note over U,DB: user opens link —GET /api/auth/magic/verify
    U->>B: click link
    B->>C: verifyMagic(token, state, next)
    C->>C: compare stored state (constant-time)
    break state mismatch
        C-->>B: redirect /auth?error=magic_state
    end
    C->>A: loginWithMagicToken(token)
    A->>DB: SELECT magic_link_token WHERE token_hash
    A->>DB: UPDATE magic_link_token SET used_at WHERE id AND used_at IS NULL AND expires_at > now
    alt already used / expired / claim lost
        A-->>C: throw 401 INVALID_TOKEN
        C-->>B: redirect /auth?error=magic_invalid
    else valid
        A->>DB: find or insert app_user by email
        A->>M: mfaEnabled? createChallenge
        A-->>C: MagicLogin(userId, mfaChallenge?)
    end
    alt mfa challenge
        C-->>B: redirect /auth?mfa=1&challenge=..
    else no mfa
        C->>A: mergeGuestWorkspace(guestId, userId)
        C->>S: revokeIfPresent(old), start(fresh)
        C-->>B: redirect next
    end
    B-->>U: signed in
```
