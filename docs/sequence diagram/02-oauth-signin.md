# SD02 —OAuth Sign-in (GitHub / Google / Apple)

**Covers:** `OAuthController.start / callback`, `OAuthService.exchange`,
`AppService.ensureOAuthUser / mergeGuestWorkspace`, `MfaService.createChallenge`.

Source: `api/OAuthController.java`, `app/OAuthService.java`.

External provider participates as `:Provider`. `alt/else` models the provider branches, and
`break` models a bad `state`. Control is **centralized** in the controller.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant P as :Provider
    participant C as :OAuthController
    participant O as :OAuthService
    participant A as :AppService
    participant M as :MfaService
    participant S as :SessionService
    participant DB as :JdbcTemplate

    Note over U,DB: GET /api/auth/oauth/{provider}
    U->>B: click "Continue with GitHub"
    B->>C: start(request, provider, next)
    C->>O: enabled(provider)?
    alt not enabled
        C-->>B: redirect /auth?error=provider_unavailable
    else enabled
        C->>C: state = UUID(), store in session
        C->>O: authorizeUrl(provider, state, baseUrl, next)
        O-->>C: provider authorize URL
        C-->>B: 302 redirect to Provider
    end

    U->>P: consent
    P-->>B: 302 callback?code=..&state=..

    Note over U,DB: GET /api/auth/oauth/{provider}/callback
    B->>C: callback(provider, code, state, error)
    break error param present
        C-->>B: redirect /auth?error=access_denied
    end
    break state mismatch / provider mismatch
        C-->>B: redirect /auth?error=state_mismatch
    end
    break code missing
        C-->>B: redirect /auth?error=missing_code
    end
    C->>O: exchange(provider, baseUrl, code)
    O->>P: POST token_url (client_id, secret, code)
    P-->>O: access_token (or apple id_token)
    alt github
        O->>P: GET /user (+ /user/emails)
    else google
        O->>P: GET /v1/userinfo
    else apple
        O->>O: verify id_token signature (JWKS)
    end
    O-->>C: Profile(providerAccountId, email, name)

    C->>DB: lookup oauth_account(provider, providerAccountId)
    C-->>B: [linked user soft-deleted] redirect /auth?error=oauth_failed
    alt linked user found (active)
        C->>C: userId = existing
    else not linked
        C->>A: ensureOAuthUser(guestId, email, name)
        A->>DB: find/insert app_user, claim guest
        A-->>C: userId
        C->>A: mergeGuestWorkspace(guestId, userId)
        C->>DB: INSERT oauth_account
    end

    C->>M: mfaEnabled(userId)?
    alt mfa enabled
        C->>M: createChallenge(userId)
        C-->>B: redirect /auth?mfa=1&challenge=..&next=..
    else no mfa
        C->>S: revokeIfPresent(old), old.invalidate()
        C->>S: start(fresh, userId, mfa=true)
        Note over C: MFA_VERIFIED=true
        C-->>B: redirect next
    end
    B-->>U: signed in
```
