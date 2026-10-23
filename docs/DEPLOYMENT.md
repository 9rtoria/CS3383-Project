# Deployment

**Target:** one Next.js web process + one jobs worker + SQLite (demo/small team)  
**Production path:** PostgreSQL + object storage + managed SMTP  
**Last updated:** 2026-10-23

> **Verification status:** the local production build and `next start` were executed and tested. The Dockerfile, Compose file, and CI workflow are delivered and syntax-reviewed, but **Docker was not available in the delivery environment**, so the image was not built or run here. Treat Docker as unverified until you run the commands below.

## 1. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | `file:./prisma/dev.db` locally; `file:/app/data/drift.db` in Compose |
| `APP_URL` | Yes | Public origin; used for CSRF allowlist, links, OAuth callbacks |
| `AUTH_SECRET` | Production | Session/token derivation; app refuses to boot without it |
| `APP_ENCRYPTION_KEY` | Production | AES-GCM for TOTP/OIDC/webhook secrets |
| `NODE_ENV` | Yes | `production` in deployed environments |
| `SMTP_URL` | Optional | Enables real email; without it messages are preview/outbox only |
| `SMTP_FROM` | Optional | From address |
| `GITHUB_CLIENT_ID/SECRET` | Optional | GitHub OAuth |
| `GOOGLE_CLIENT_ID/SECRET` | Optional | Google OAuth |
| `APPLE_CLIENT_ID/SECRET` | Optional | Apple OAuth |
| `AI_KILL_SWITCH` | Optional | `true` disables all assist suggestions |
| `DISABLE_ATTACHMENTS` | Optional | `true` disables uploads |
| `SEED_DEMO` | Optional | Seeds the demo workspace on setup |
| `APP_VERSION` | Optional | Reported by `/api/health` |

Never commit `.env`. Use your platform’s secret manager. `AUTH_SECRET` and `APP_ENCRYPTION_KEY` must be independent random values of at least 32 bytes.

## 2. Local production run (verified)

```bash
npm ci
npm run setup -- --seed
npm run typecheck
npm test
npm run build
$env:NODE_ENV="production"   # PowerShell; use export on Unix
npm run start
```

Open <http://localhost:3000>. The production build serves the same UI and APIs as development. Do not use the dev server for performance or E2E evidence.

Health check:

```bash
curl -i http://localhost:3000/api/health
```

Expected: `200`, `{"status":"ok","database":"ok",...}`.

## 3. Standalone Node deployment (verified build output)

`next.config.ts` sets `output: "standalone"`, so `.next/standalone/server.js` is a self-contained server.

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
cd .next/standalone
NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 node server.js
```

The standalone folder must be able to read `generated/prisma` and the native `better-sqlite3` binary. Keep `DATABASE_URL` pointed at a writable path outside the build directory, and back up that path.

Run jobs from the project checkout (not the standalone folder) because `scripts/jobs.ts` needs `tsx` and the source tree:

```bash
npm run jobs
```

Schedule it every 1–5 minutes. See [OPERATIONS.md](OPERATIONS.md).

## 4. Docker

### Build

```bash
docker build -t drift:1.0.0 --target runner .
```

Targets:

| Target | Contents | Use |
|---|---|---|
| `runner` | Standalone server, static assets, non-root `nextjs` user | Web |
| `migrate` | Prisma CLI + migrations | One-shot migration |
| `tools` | Full source + dev deps (`tsx`) | Jobs / seed |

### Compose

```bash
# .env must contain AUTH_SECRET and APP_ENCRYPTION_KEY
docker compose up --build permissions migrate app
# optional seed
docker compose --profile seed run --rm seed
# optional jobs worker
docker compose --profile jobs up -d jobs
```

Compose uses a named volume `drift-data` at `/app/data` for SQLite, attachments, and backups. The `permissions` one-shot fixes volume ownership for uid 1001; `migrate` runs as the same uid so the database is writable by the app.

### What is not verified

- Image build and container start were not executed here.
- The standalone image’s native `better-sqlite3` binary was not tested on `node:24-bookworm-slim`.
- Compose health/ordering was not exercised.
- No TLS terminator is included; put Caddy/Nginx/ALB in front.

If the build fails on a native module, install `python3 make g++` in the `deps` stage (already present) and confirm the runtime architecture matches the build architecture.

## 5. Reverse proxy and TLS

Terminate TLS at a proxy and forward to `127.0.0.1:3000`. Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`. Set `APP_URL` to the external HTTPS origin; cookies are `Secure` in production.

Nginx sketch:

```nginx
server {
  listen 443 ssl http2;
  server_name drift.example.com;
  client_max_body_size 12m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Do not cache `/api/*` or authenticated HTML at the proxy. The app sets `cache-control: no-store` on API responses; preserve it.

## 6. PostgreSQL rollout

SQLite is intentional for the demo but is a single-writer database. For production:

1. Provision PostgreSQL 16+ with automated backups and PITR.
2. Change the Prisma datasource provider to `postgresql` and use `@prisma/adapter-pg`.
3. Regenerate migrations for PostgreSQL; do not replay SQLite SQL.
4. Replace FTS5 with `tsvector` + GIN (or an external search service).
5. Move attachments to S3-compatible storage with signed URLs.
6. Run web replicas behind a load balancer; run jobs as a singleton/leader-elected worker.
7. Add a shared rate-limit store (Redis) because the current limiter is per-process memory.
8. Re-run typecheck, unit, E2E, accessibility, and Lighthouse against the new topology.
9. Load test with k6 at the target concurrency before cutover.

The data model is already tenant-scoped; the main work is migration SQL, search, file storage, and the rate limiter.

## 7. CI

`.github/workflows/ci.yml` runs install → Prisma generate → migrate → typecheck → lint → unit → build → Playwright E2E → audit. It uses a disposable SQLite database and dummy CI secrets. It does not run Docker, live OAuth/SSO, SMTP, or load tests.

The E2E step starts the production server and points Playwright at `http://localhost:3000`. Keep the host consistent: cookies are host-scoped, so `localhost` and `127.0.0.1` are different origins.

## 8. Release checklist

- [ ] `npm ci` clean
- [ ] `npx prisma migrate deploy` applied
- [ ] `npm run typecheck` 0 errors
- [ ] `npm run lint` 0 errors
- [ ] `npm test` 78/78
- [ ] `npm run build` succeeds
- [ ] `/api/health` 200
- [ ] Guest capture works in a private window
- [ ] Sign-in, sign-out, and MFA challenge work
- [ ] Board move + undo works
- [ ] Search returns scoped results
- [ ] Public share opens without a session and is read-only
- [ ] Export/import round-trip works
- [ ] Jobs run and write `JobRun`
- [ ] Backup + restore rehearsed
- [ ] Security headers present (`curl -I`)
- [ ] No secrets in the image or logs
- [ ] Rollback image and DB backup retained

## 9. Rollback

1. Stop web and jobs.
2. Restore the previous database backup and attachments.
3. Deploy the previous image/build.
4. Run `npx prisma migrate deploy` only if the previous build expects the older schema; if a migration is destructive, restore the backup instead.
5. Probe health, sign in, capture, and open a board.

Keep migrations backward-compatible for one release (expand/contract) so a rollback does not require a data restore.

## 10. Known deployment gaps

- Docker image unverified (no Docker in the delivery environment).
- SQLite is not suitable for horizontal scale or the 10k-user target.
- No automated backup job; `BackupRun` is a metadata model only.
- No object storage; attachments are local files.
- No malware scanning.
- No SSRF allowlist for webhooks.
- No live OAuth/SSO round-trip without provider credentials.
- No centralized rate limiter; per-process memory only.
- No TLS/reverse proxy included.

These are tracked in `RISKS.md` and `BACKLOG.md`.
