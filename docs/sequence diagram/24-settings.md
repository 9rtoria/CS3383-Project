# SD24 — Personal Settings Load & Autosave

**Covers:** `SettingsController` (`GET/PATCH /api/settings`),
`SettingsService.get / patch`.

Source: `api/SettingsController.java`, `app/SettingsService.java`.

The browser loads settings on init with a dedicated `GET /api/settings` (not via bootstrap), then
`PATCH`es individual sections (appearance / language / planning / notifications / auto-plan / …)
with debounced autosave. Values are stored as raw columns (schema defaults apply); there is no
server-side parsing or bounds-checking.

```mermaid
sequenceDiagram
    autonumber
    actor U as :User
    participant B as :Browser
    participant C as :SettingsController
    participant S as :SettingsService
    participant AC as :AccountController
    participant DB as :JdbcTemplate

    Note over U,DB: GET /api/settings (on init)
    B->>C: get(session)
    C->>S: get(userId)
    S->>DB: INSERT OR IGNORE user_settings (ensure row exists)
    S->>DB: SELECT * FROM user_settings WHERE user_id
    S-->>C: raw settings row (schema defaults)
    C-->>B: {"settings": <row>}
    B->>B: applySettings() — theme, locale, quiet hours

    Note over U,DB: PATCH /api/settings (debounced autosave)
    U->>B: change a control (e.g. theme, digest hour)
    B->>B: updateSettings(patch) → debounce
    B->>C: patch(session, partialSettings)
    C->>S: patch(userId, changes)
    S->>DB: INSERT OR IGNORE user_settings (ensure row exists)
    loop each key in changes present in COLUMNS map
        S->>DB: UPDATE user_settings SET <column> = value (only provided columns)
    end
    S->>DB: SELECT * FROM user_settings (re-read)
    S-->>C: updated settings
    C-->>B: 200 {"settings": <row>}

    Note over U,AC: PATCH /api/account (name / timezone)
    U->>B: edit profile
    B->>AC: AccountController.update → AppService.updateAccount
    Note over B,AC: see SD22
```
