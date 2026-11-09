# SD05 —Two-factor (TOTP) Setup / Enable / Disable + Session Revoke

**Covers:** `SecurityController.status / action / revokeSession`,
`MfaService.status / setup / enable / disable / revokeSession / qrDataUrl`.

Source: `api/SecurityController.java`, `app/MfaService.java`.

Secret material is encrypted before it touches the DB (AES via `encrypt/decrypt`). Setup stores
a *pending* secret; `enable` promotes it. Disable is blocked if an org requires MFA (`break`).

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :SecurityController
    participant M as :MfaService
    participant DB as :JdbcTemplate

    Note over U,DB: GET /api/security/mfa
    B->>C: status(session)
    C->>M: status(userId, currentSessionId)
    M->>DB: SELECT app_user.mfa_enabled, auth_session list
    M-->>C: {mfaEnabled, sessions[]}
    C-->>B: status JSON

    Note over U,DB: POST /api/security/mfa  action="setup"
    U->>B: Enable two-factor
    B->>C: action(session,{action:"setup"})
    C->>M: setup(userId, currentCode)
    alt already enabled and current code blank
        M-->>C: throw 400 badRequest ("Enter your current code to reset")
    else already enabled and current code wrong
        M-->>C: throw 401 INVALID_CREDENTIALS
    else
        M->>M: secret = generateSecret() (base32)
        M->>M: encrypt(secret) —pending
        M->>DB: UPDATE app_user SET mfa_pending_secret_enc
        M->>M: qrDataUrl(otpauth:// URI)
        M-->>C: {secret, uri, qrDataUrl}
    end
    C-->>B: QR shown to scan

    Note over U,DB: POST /api/security/mfa  action="enable"
    U->>B: enter 6-digit code
    B->>C: action(session,{action:"enable",secret,code})
    C->>M: enable(userId, input)
    M-->>C: [secret blank] throw 400 "Start two-factor setup first."
    M->>DB: SELECT mfa_pending_secret_enc
    M->>M: [stored != input.secret] throw 400 "setup secret changed"
    M->>M: verifyTotp(stored, code)
    alt code invalid
        M-->>C: throw 401
    else ok
        M->>M: backupCodes = generateBackupCodes(), hash each
        M->>DB: UPDATE app_user SET mfa_enabled=1, mfa_secret_enc, hashed codes
        M-->>C: {backupCodes[]}
    end
    C->>C: session.setAttribute(MFA_VERIFIED, true)
    C-->>B: show backup codes

    Note over U,DB: POST /api/security/mfa  action="disable"
    B->>C: action(session,{action:"disable",code})
    C->>M: disable(userId, code)
    M-->>C: [mfaEnabled != 1] throw 400 "Two-factor is not enabled."
    M->>DB: SELECT workspaces WHERE require_mfa=1
    break org requires MFA
        M-->>C: throw 403 forbidden
    end
    M->>M: verifyCode(secret, code)
    M->>DB: UPDATE app_user SET mfa_enabled=0, clear secrets
    M-->>C: {mfaEnabled:false}
    C->>C: session.setAttribute(MFA_VERIFIED, false)

    Note over U,DB: DELETE /api/security/mfa  (revoke another session)
    B->>C: revokeSession(session,{sessionId})
    alt sessionId is current / "current" / null
        C-->>B: {revoked:false, reason:"Use sign out for the current session."}
    else otherwise
        C->>M: revokeSession(userId, sessionId)
        M->>DB: UPDATE auth_session SET revoked_at
        C-->>B: {revoked:true}
    end
```
