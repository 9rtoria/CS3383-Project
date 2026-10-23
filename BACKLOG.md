# BACKLOG

Out-of-scope per brief or discovered while building. Not implemented in v1.3. No backlog item is represented by a fake control in the app.

## Explicitly out of scope

| ID | Item | Why deferred | Impact / readiness note |
|---|---|---|---|
| BL-001 | Team chat / direct messaging | Brief excludes team chat. | Comments cover task discussion. |
| BL-002 | Portfolio management | Brief excludes full portfolio management. | Workload view is board-scoped. |
| BL-003 | Billing, subscriptions, payment processing | Brief excludes billing. | Workspace types are not metered. |
| BL-004 | Native iOS/Android applications | Brief excludes native apps. | Responsive PWA installable. |
| BL-005 | Fully autonomous AI scheduling | Brief explicitly forbids autonomous mutations. | Today proposes with accept/edit/dismiss. |
| BL-006 | SAML 2.0 IdP support | OIDC selected as the single SSO protocol for v1. | Common enterprise gap; add via a maintained SAML library. |
| BL-007 | Two-way Google/Microsoft Calendar sync | ICS subscription delivered; provider OAuth per-user is large. | ICS covers read-out; write-back deferred. |
| BL-008 | Virus scanning for attachments | Requires external scanning service. | Uploads restricted; risk R-005; disable via flag if required. |
| BL-009 | Strict nonce-based CSP | Next inline bootstrap work. | CSP present; `unsafe-inline` documented. |
| BL-010 | Real-time multiplayer presence / live cursors | Collaborative editing not specified. | Conflict-safe writes and activity feed cover coordination. |
| BL-011 | Full i18n translations / RTL packs | Externalized strings and formatting delivered. | Add locale bundles; CSS uses logical properties. |
| BL-012 | On-prem/self-hosted AI model deployment | External AI not used in v1. | Local heuristics preserve data boundary. |
| BL-013 | Slack/Teams OAuth app installation | Generic incoming webhook delivered. | OAuth distribution adds app-review overhead. |
| BL-014 | Audit hash chain / WORM export | Basic append-only audit delivered. | Required for high-assurance regulated buyers. |
| BL-015 | Bulk 50k-row migration importer | 1k/5MB import cap. | Background importer needed. |
| BL-016 | Public share link expiry/password | Token sharing delivered. | Secure defaults via revocation. |
| BL-017 | Custom fields | Not in brief. | Labels + description cover v1. |
| BL-018 | Time tracking timers / billable rates | Estimates only. | Freelancer invoicing not in scope. |
| BL-019 | Board-level automation permissions | Workspace-scoped rules. | Org policy can disable automations. |
| BL-020 | External error-tracking vendor integration | Structured logs and endpoint delivered. | Add Sentry/OTel exporter with DSN in deployment. |

## Discovered opportunities (post-v1)

| ID | Idea | User problem | Proposed acceptance test |
|---|---|---|---|
| BL-101 | Quick-capture “capture everywhere” browser extension | Capture outside the tab. | Hotkey saves to inbox in ≤300ms and syncs. |
| BL-102 | Email-to-task address | Capture from email clients. | Signed inbound email becomes a parsed task. |
| BL-103 | Natural-language bulk import cleanup wizard | Migrations produce messy data. | Import preview with duplicate detection and undo. |
| BL-104 | Dependency-aware daily plan | Blocked tasks crowd Today. | Suggestions exclude blocked tasks and show reason. |
| BL-105 | Shared inbox triage | Team intake is email-heavy. | Inbox board with assignment rules and SLA clock. |
| BL-106 | Accessible command-palette macros | Repetitive multi-step workflows. | Record and replay actions with confirmation. |
| BL-107 | Offline attachment cache | Field work without connectivity. | Read attachments offline with size cap and purge. |
| BL-108 | Workforce capacity heatmap | Managers need aggregate effort. | Week × person load with overcommit warnings. |
| BL-109 | Board snapshots / time travel | Recover from mass edits. | Snapshot diff and restore with audit. |
| BL-110 | Bring-your-own LLM with DLP controls | Users want AI on their provider. | Flagged, reason-bearing suggestions, no training, region pinning. |
| BL-111 | Webhook HMAC signing + SSRF URL allowlist | Receivers cannot verify origin; server-side request forgery risk. | Signed payload verifies with a shared secret; blocked private/metadata IP ranges. |
| BL-112 | Automated backup + restore drill | SQLite/attachment loss would be operator-dependent. | Scheduled encrypted backup, restore into staging, checksum verified. |
| BL-113 | Shared rate-limit store | Per-process limits break with replicas. | Redis-backed limiter with identical bucket behavior under 2 replicas. |
| BL-114 | SCIM 2.0 provisioning | Enterprise buyers need automated joiner/mover/leaver. | Create/deactivate users and groups from an IdP test tenant. |
| BL-115 | All-or-nothing staged import | Partial commits complicate migrations. | Preview + staging table + atomic promote/rollback. |
| BL-116 | Manual assistive-technology audit | Automated axe cannot prove AA. | NVDA/VoiceOver/zoom/HC scripts pass; VPAT updated with evidence. |
