# SD01 —Authentication & Session

**Covers:** `AuthController.guest / signin / mfaChallenge / session / signOut`,
`SessionService.start / touch / revoke`, `AppService.createGuest / signin / bootstrap / mergeGuestWorkspace`.

Source: `api/AuthController.java`, `app/SessionService.java`, `app/AppService.java`.

Parsed with `app.js#request`. Control is **centralized** in the controller (fork style): the
controller decides every look-up/redirect; the service only persists.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser(app.js)
    participant C as :AuthController
    participant S as :SessionService
    participant A as :AppService
    participant M as :MfaService
    participant DB as :JdbcTemplate

    Note over U,DB: POST /api/auth/guest
    U->>B: open app
    B->>C: guest(request, session)
    C->>C: session.getAttribute(SESSION_USER)
    alt existing user and touch ok
        C->>S: touch(session, userId)
        S->>DB: SELECT auth_session (revoked?/expired?)
        S->>DB: UPDATE auth_session SET last_used_at, expires_at
        S-->>C: ok
        C->>A: bootstrap(userId)
        A->>DB: SELECT workspaces, boards, columns, labels
        A-->>C: bootstrap payload
    else no user, or touch fails (revoked/expired)
        Note over C: if user attribute was present but touch failed, removeAttribute(SESSION_USER), fall through to createGuest()
        C->>A: createGuest()
        A->>DB: INSERT app_user (is_guest=1)
        A->>A: createStarterWorkspace("Personal")
        A->>DB: INSERT workspace, membership, board, columns
        A->>DB: INSERT labels
        A-->>C: bootstrap
        C->>S: start(session, userId, request, mfa=false)
        S->>DB: INSERT auth_session(hash, ua, expires)
    end
    C-->>B: bootstrap JSON
    B-->>U: render board

    Note over U,DB: POST /api/auth/signin (email + password)
    U->>B: submit credentials
    B->>C: signin(request, {email,password})
    C->>A: signin(input)
    A->>DB: SELECT app_user WHERE email
    A->>A: passwordEncoder.matches(pw, hash)
    alt credentials invalid
        A-->>C: throw 401 INVALID_CREDENTIALS
        C-->>B: 401
    else mfaEnabled = 1 and no totp
        A->>M: createChallenge(userId)
        M-->>A: challenge token
        A-->>C: AuthResult(mfaRequired=true, challenge)
        C-->>B: {mfaRequired:true, challenge}
        B-->>U: show authenticator field
        U->>B: enter 6-digit code
        B->>C: mfaChallenge(request,{challenge,code})
        C->>A: verifyMfaChallenge(challenge, code)
        A->>M: verifyChallenge(token, code)
        M->>M: verifyTotp() | backup code
        M-->>A: userId
        A-->>C: AuthResult(mfaVerified=true)
        opt guest session differs from user
            C->>A: mergeGuestWorkspace(guestId, userId)
        end
        C->>S: revokeIfPresent(old) + invalidate
        C->>S: start(session, userId, request, mfa=true)
    else ok
        opt guest session differs from user
            C->>A: mergeGuestWorkspace(guestId, userId)
        end
        C->>S: revokeIfPresent(old) + invalidate
        C->>S: start(new session)
        C->>A: bootstrap(userId)
        A-->>C: bootstrap
    end
    C-->>B: bootstrap JSON

    Note over U,DB: GET /api/auth/session  (on every refresh)
    B->>C: session(session)
    C->>S: touch(session, userId)
    S->>DB: SELECT auth_session, UPDATE last_used_at+expires_at
    S-->>C: valid?
    alt valid
        C->>A: bootstrap(userId)
        C-->>B: {authenticated:true, bootstrap}
    else expired/revoked
        C-->>B: {authenticated:false}
    end

    Note over U,DB: DELETE /api/auth/signout
    U->>B: click sign out
    B->>C: signOut(session)
    C->>S: revokeIfPresent(session)
    S->>DB: UPDATE auth_session SET revoked_at
    C->>C: session.invalidate()
    C-->>B: {signedOut:true}
```
