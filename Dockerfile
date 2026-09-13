# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS deps

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY scripts/check-node-runtime.mjs ./scripts/check-node-runtime.mjs
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS document-source-native
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev linux-libc-dev \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/document-source/launcher.c /build/launcher.c
COPY scripts/document-source/seal.c scripts/document-source/seal-policy.h /build/
RUN mkdir -p /out/runtime /out/proof \
  && gcc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared -I/usr/local/include/node -Wl,-z,relro,-z,now /build/seal.c -o /out/runtime/seal.node \
  && gcc -std=c11 -O2 -Wall -Wextra -Werror -Wl,-z,relro,-z,now /build/launcher.c -o /out/runtime/launcher \
  && gcc -std=c11 -O2 -Wall -Wextra -Werror -pthread -DEVO_DOCUMENT_TEST -Wl,-z,relro,-z,now /build/launcher.c -o /out/proof/launcher.test

FROM deps AS document-source-assets
COPY scripts/document-source ./scripts/document-source
COPY src/lib/server/document-source-preflight.ts ./src/lib/server/document-source-preflight.ts
RUN node scripts/document-source/build.mjs /out

# Narrow real-runtime test target; no Next build, app configuration or credentials.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS document-source-runtime
COPY --from=document-source-native --chown=0:0 --chmod=0555 /out/runtime/ /opt/evo-document-runtime/
COPY --from=document-source-assets --chown=0:0 /out/runtime/ /opt/evo-document-runtime/
USER 1001:1001
CMD ["/opt/evo-document-runtime/launcher"]

FROM document-source-runtime AS document-source-runtime-test
USER root
RUN apt-get update && apt-get install -y --no-install-recommends qpdf \
  && rm -rf /var/lib/apt/lists/*
COPY --from=document-source-native --chown=0:0 --chmod=0555 /out/proof/launcher.test /opt/evo-document-runtime/launcher.test
COPY --from=document-source-assets --chown=0:0 /out/proof/ /opt/evo-document-runtime/
USER 1001:1001
CMD ["node", "--test", "/opt/evo-document-runtime/test-harness.mjs"]

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
COPY --from=document-source-runtime --chown=0:0 /opt/evo-document-runtime/ /opt/evo-document-runtime/

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
