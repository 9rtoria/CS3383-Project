# syntax=docker/dockerfile:1
# Drift production image. Docker execution is unverified in the delivery
# environment because Docker is not installed there; see docs/DEPLOYMENT.md.
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
# Build-time placeholders: the runtime stage receives real secrets. These are
# never copied into the runner image.
ENV AUTH_SECRET=build-only-not-a-runtime-secret
ENV APP_ENCRYPTION_KEY=build-only-not-a-runtime-key
ENV APP_URL=http://localhost:3000
RUN npx prisma generate && npm run build

# One-shot migration image with the Prisma CLI and checked-in migrations.
FROM base AS migrate
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
COPY generated ./generated
CMD ["npx", "prisma", "migrate", "deploy"]

# Jobs/tools image: full source plus dev dependencies for tsx.
FROM builder AS tools
CMD ["npx", "tsx", "scripts/jobs.ts"]

FROM base AS runner
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/data/attachments /app/data/backups \
  && chown -R nextjs:nodejs /app
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
