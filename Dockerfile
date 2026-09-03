# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS deps

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY scripts/check-node-runtime.mjs ./scripts/check-node-runtime.mjs
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runner

WORKDIR /app

ARG EVO_IMAGE_SOURCE
ARG EVO_IMAGE_REVISION
ARG EVO_IMAGE_VERSION

LABEL org.opencontainers.image.source="${EVO_IMAGE_SOURCE}" \
      org.opencontainers.image.revision="${EVO_IMAGE_REVISION}" \
      org.opencontainers.image.version="${EVO_IMAGE_VERSION}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV EVO_RELEASE_REVISION="${EVO_IMAGE_REVISION}"
ENV EVO_RELEASE_VERSION="${EVO_IMAGE_VERSION}"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs \
  && mkdir -p /app/output \
  && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/transcribe_mlx_chunks.py ./scripts/transcribe_mlx_chunks.py
COPY --from=builder --chown=nextjs:nodejs --chmod=0555 /app/.next/platform-knowledge-import.mjs ./scripts/import-platform-knowledge-bundle.mjs

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
