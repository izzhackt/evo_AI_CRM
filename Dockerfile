# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY scripts/check-node-runtime.mjs ./scripts/check-node-runtime.mjs
RUN npm ci

FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV EVO_DB_PATH=/app/data/edu-admin.db
ENV EVO_BACKUP_DIR=/app/backups

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs \
  && mkdir -p /app/data /app/output /app/backups \
  && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/bootstrap-admin.mjs ./scripts/bootstrap-admin.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/backup-sqlite.mjs ./scripts/backup-sqlite.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/transcribe_mlx_chunks.py ./scripts/transcribe_mlx_chunks.py

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
