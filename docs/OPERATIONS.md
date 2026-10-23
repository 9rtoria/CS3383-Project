# Operations runbook

**Service:** Drift web app + jobs worker  
**Database:** SQLite at `prisma/dev.db` (demo/small team)  
**Last updated:** 2026-10-23

## 1. Processes

| Process | Command | Role |
|---|---|---|
| Web | `npm run start` | Next.js SSR, APIs, static assets |
| Jobs | `npm run jobs` | Reminders, email retry, digests, webhook retry, retention, housekeeping |
| Setup | `npm run setup -- --seed` | Create `.env`, generate client, migrate, optional seed |
| Health probe | `GET /api/health` | DB check + latency |
| Metrics | `GET /api/metrics?workspaceId=…` | Process and tenant counters (admin) |

The web process does not require the jobs process to serve traffic. A missing scheduler degrades reminders, digests, and retries, not capture or boards.

## 2. First deploy checklist

1. Copy `.env.example` to `.env` or run `npm run setup`.
2. Set `AUTH_SECRET` and `APP_ENCRYPTION_KEY` to independent random values (≥32 bytes). Production refuses to boot without them.
3. Set `APP_URL` to the public HTTPS origin.
4. Set `DATABASE_URL`; for the demo keep `file:./prisma/dev.db`.
5. Configure `SMTP_URL` and `SMTP_FROM` if email delivery is required.
6. Run `npx prisma migrate deploy`.
7. Run `npm run build` and `npm run start`.
8. Probe `/api/health`; expect `200` and `"database":"ok"`.
9. Schedule `npm run jobs` every 1–5 minutes.
10. Put the SQLite file and `data/` on a persistent volume; never bake them into the image.

## 3. Health and metrics

```bash
curl -s http://localhost:3000/api/health
```

```json
{"status":"ok","version":"1.0.0","database":"ok","latencyMs":1,"timestamp":"…","uptimeSeconds":42}
```

- `503` with `"status":"degraded"` means the DB probe failed. Check disk space, file permissions, and SQLite locks.
- `/api/metrics` requires a session; with `workspaceId` it requires ADMIN + `audit:read`. It reports uptime, Node version, RSS, task/board/member counts, emails in the last 24 h, and unread notifications.
- Logs are JSON lines on stdout: `level`, `requestId`, `method`, `path`, `status`, `durationMs`, `userId`. Ship them to your log platform; do not log request bodies.

## 4. Background jobs

```bash
npm run jobs              # all jobs
npm run jobs -- reminders # due reminders only
npm run jobs -- webhooks  # failed webhook retries only
npm run jobs -- digest    # daily digests only
npm run jobs -- retention # retention/housekeeping only
```

| Job | Behavior | Idempotency |
|---|---|---|
| `housekeeping` | Purge expired sessions, magic links, idempotency keys, webhook deliveries, terminal emails, old client errors | Delete-by-cutoff |
| `email-retry` | Retry queued/failed SMTP messages older than 60 s, max 25 | Status transition |
| `due-reminders` | Materialize due reminders into notifications/email; respects quiet hours; marks `sentAt` | `sentAt` guard |
| `webhook-retry` | Retry failed deliveries up to 3 attempts, 5/15/45-minute backoff | `attempts` + `nextAttemptAt` |
| `daily-digests` | One digest per user per 20 h at their local digest hour | Recent-message check |
| `retention` | Soft-delete archived tasks past workspace retention; purge audit past retention | Cutoff updates |

Every run writes a `JobRun` row with status and JSON details. A failed run sets a non-zero exit code; alert on that and on missing runs (a heartbeat check).

**Cron example**

```cron
*/5 * * * * cd /srv/drift && /usr/bin/npm run jobs >> /var/log/drift-jobs.log 2>&1
```

Run the jobs worker as a singleton. Two workers are safe for most deletes but can duplicate digest/reminder work at the edges; use a leader lock or a single scheduler container.

## 5. Backup and restore

### SQLite (current)

Stop writes or use SQLite’s online backup API. A plain file copy while the app is writing can be inconsistent.

```bash
# Preferred: SQLite online backup (sqlite3 CLI)
sqlite3 prisma/dev.db ".backup 'data/backups/drift-$(date +%Y%m%d-%H%M).db'"

# Simple maintenance-window copy
systemctl stop drift
cp prisma/dev.db "data/backups/drift-$(date +%Y%m%d-%H%M).db"
systemctl start drift
```

Also back up `data/attachments/` and `data/runtime-secrets.json` (development only; production uses env secrets). Encrypt backups at rest and restrict access.

Restore:

```bash
systemctl stop drift
cp data/backups/drift-YYYYMMDD-HHMM.db prisma/dev.db
# restore attachments to data/attachments/
npx prisma migrate deploy
systemctl start drift
curl -f http://localhost:3000/api/health
```

The `BackupRun` model exists for recording backup metadata, but **no automated backup job ships in v1**. Add a cron/object-storage backup before production. This is a documented gap.

### PostgreSQL (future)

Use managed automated backups + point-in-time recovery. Test restore quarterly. See [DEPLOYMENT.md](DEPLOYMENT.md).

## 6. Secrets

| Secret | Use | Rotation |
|---|---|---|
| `AUTH_SECRET` | Session/token derivation and signed flows | Rotate with a maintenance window; existing sessions may be invalidated |
| `APP_ENCRYPTION_KEY` | AES-GCM for TOTP/OIDC/webhook secrets | Requires re-encryption migration; do not rotate casually |
| `SMTP_URL` | Email delivery | Rotate at the relay; restart web + jobs |
| OAuth client secrets | GitHub/Google/Apple | Rotate in provider console and env |
| OIDC client secret | Workspace SSO | Re-enter in Settings; stored encrypted |

Never commit `.env`. Production startup fails if `AUTH_SECRET` or `APP_ENCRYPTION_KEY` is missing. Development generates `data/runtime-secrets.json` with mode `0600`; do not copy that file to production.

## 7. Email

- Without `SMTP_URL`, messages are persisted with status `preview` and no mail is sent. Invite and magic-link URLs are exposed only when `NODE_ENV !== "production"` or `E2E=true`.
- With SMTP, `queueEmail` persists first, then attempts delivery. Failures stay `failed` with a truncated error and are retried by `email-retry`.
- Check the outbox:

```sql
SELECT id, to, kind, status, createdAt, error FROM EmailMessage ORDER BY createdAt DESC LIMIT 20;
```

- If deliverability fails, verify `SMTP_FROM`, SPF/DKIM/DMARC, and relay credentials. The app does not manage DNS.

## 8. Attachments

- Stored under `data/attachments/` with random names; metadata in SQLite.
- Downloads re-check workspace membership and use `Content-Disposition: attachment`.
- `DISABLE_ATTACHMENTS=true` turns uploads off globally.
- MIME allowlist + signature checks + size cap are enforced. **No malware scanner.** For untrusted users, disable attachments or scan the volume out-of-band.
- Back up the directory with the database; a DB restore without files leaves broken attachments.

## 9. Webhooks

- First attempt is fire-and-forget from the request path; the delivery row is persisted.
- `npm run jobs -- webhooks` retries failures up to 3 attempts with backoff.
- Inspect failures:

```sql
SELECT id, webhookId, eventType, status, attempts, nextAttemptAt, response
FROM WebhookDelivery ORDER BY createdAt DESC LIMIT 20;
```

- No SSRF allowlist and no payload signing in v1. Restrict egress and terminate webhooks behind a gateway you control. See [API.md](API.md) §7.

## 10. Common incidents

| Symptom | Likely cause | Action |
|---|---|---|
| `503` health, `database:error` | SQLite file missing/locked/disk full | Check volume, permissions, `PRAGMA integrity_check`, restore backup |
| `429` on bootstrap | Dev HMR or a client retry loop | Confirm production build; inspect rate-limit keys; restart |
| Login loops | `APP_URL` host mismatch vs cookie host | Use one hostname (localhost vs 127.0.0.1); set `APP_URL` to the public origin |
| Invite/magic link missing | No SMTP | Configure SMTP; in dev use the preview URL |
| MFA required but no access | Workspace `requireMfa` and session not MFA-verified | Complete `/auth?mode=mfa`; admin can disable policy |
| Reminders not arriving | Jobs not scheduled, quiet hours, or task completed | Check `JobRun`, `Reminder.sentAt`, user quiet hours |
| Webhook failures | Endpoint down or blocked egress | Check delivery rows; fix endpoint; retry job |
| Build OOM | Next build on a small runner | Increase memory; build in CI; use standalone output |
| Prisma config error | Missing `prisma7.config.ts` or generated client | Run `npx prisma generate`; keep config at repo root |

## 11. Upgrade procedure

1. Back up DB + attachments.
2. Pull the release; review migrations.
3. `npm ci`
4. `npx prisma generate`
5. `npx prisma migrate deploy`
6. `npm run build`
7. Restart web, then jobs.
8. Probe health, sign in, capture a task, open a board.
9. Keep the previous build and backup until the smoke test passes.

## 12. On-call checklist

- [ ] `/api/health` 200 and DB latency normal
- [ ] Error rate and p95 latency within budget
- [ ] Jobs ran in the last 5 minutes; no failed `JobRun`
- [ ] Email queue not growing unbounded
- [ ] Webhook failure rate understood
- [ ] Disk space for DB, attachments, logs, backups
- [ ] No unexplained 5xx spike or auth failures
- [ ] Recent backup exists and is restorable

Escalate security incidents per [SECURITY.md](SECURITY.md). Preserve logs and request IDs; do not delete evidence.
