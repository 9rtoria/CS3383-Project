# SD04 —Organization SSO (OIDC) Sign-in

**Covers:** `SsoController.start / callback`, `SsoService.start / complete`,
`discover / exchangeCode / userInfo`, `MfaService.createChallenge`.

Source: `api/SsoController.java`, `app/SsoService.java`.

The identity provider (`:IdP`) is contacted three times: discovery document, token endpoint,
userinfo endpoint —a **stair** (delegated) sequence inside `SsoService`.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :SsoController
    participant S as :SsoService
    participant I as :IdP
    participant M as :MfaService
    participant SS as :SessionService
    participant DB as :JdbcTemplate

    Note over U,DB: GET /api/auth/sso/{workspaceId}
    U->>B: "Sign in with company SSO"
    B->>C: start(workspaceId)
    C->>S: start(workspaceId, baseUrl, session)
    S->>DB: SELECT oidc_config (enabled?)
    alt disabled / not found
        S-->>C: redirect {baseUrl}/?ssoError=sso_unavailable
    else discovery failed
        S-->>C: redirect {baseUrl}/?ssoError=sso_discovery_failed
    else enabled
        S->>I: GET {issuer}/.well-known/openid-configuration
        I-->>S: Discovery(auth, token, userinfo)
        S->>S: validateIssuer/validateEndpoint (https or private)
        S->>S: state = randomToken(), store in session (+expiry)
        S-->>C: authorization endpoint URL (state, client_id, redirect)
        C-->>B: 302 to IdP
    end

    U->>I: authenticate
    I-->>B: 302 callback?code=..&state=..

    Note over U,DB: GET /api/auth/sso/{workspaceId}/callback
    B->>C: callback(workspaceId, code, state, error?)
    break error param present
        C-->>B: redirect {baseUrl}/?ssoError=access_denied
    end
    C->>S: complete(workspaceId, code, state, baseUrl, session)
    S->>S: constantTimeEquals(storedState, state) && workspace match
    break state/workspace mismatch
        S-->>C: Completion.error("state_mismatch")
        C-->>B: redirect {baseUrl}/?ssoError=state_mismatch
    end
    break state expired
        S-->>C: Completion.error("state_expired")
        C-->>B: redirect {baseUrl}/?ssoError=state_expired
    end
    break state unparseable
        S-->>C: Completion.error("state_invalid")
        C-->>B: redirect {baseUrl}/?ssoError=state_invalid
    end
    S->>DB: SELECT oidc_config (enabled)
    break config missing / disabled
        S-->>C: Completion.error("sso_unavailable")
        C-->>B: redirect {baseUrl}/?ssoError=sso_unavailable
    end
    break code missing
        S-->>C: Completion.error("missing_code")
        C-->>B: redirect {baseUrl}/?ssoError=missing_code
    end
    S->>I: POST token_endpoint (grant_type, code, client_id, secret, redirect_uri)
    I-->>S: access_token
    S-->>C: [blank token] Completion.error("sso_failed")
    S->>I: GET userinfo (Bearer token)
    I-->>S: {email, email_verified, name}
    S-->>C: [no email] error("email_required") OR [unverified] error("email_unverified") OR [domain] error("domain_not_allowed")
    S->>DB: find user by email / claim guest / createSsoUser
    S-->>C: [deleted] error("account_unavailable") OR [email owned by other user] error("account_link_required")
    S->>DB: INSERT OR IGNORE membership(role=MEMBER)
    S->>DB: auditService.record("sso.login")
    S->>DB: SELECT mfa_enabled FROM app_user WHERE id
    alt mfa enabled
        S->>M: createChallenge(userId)
        S-->>C: Completion.mfa(userId, challenge)
        C-->>B: redirect /?ssoMfa=<challenge>
    else no mfa
        S-->>C: Completion.success(userId)
        C->>SS: revokeIfPresent(old), changeSessionId()
        C->>SS: start(session, userId, mfa=true)
        Note over C: MFA_VERIFIED=true
        C-->>B: redirect /
    end
```
