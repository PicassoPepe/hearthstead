# DeedWood production image (Railway, Render, Fly.io, any Docker host).
# Runtime needs DATABASE_ADMIN_URL, AUTH_SECRET and AUTH_URL — see docs/DEPLOY.md.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
# Railway passes service variables into the build only for declared ARGs. Marketing pages are
# rendered when served, but anything prerendered still gets the real address, never localhost.
ARG SITE_URL
ARG AUTH_URL
RUN pnpm build

ENV NODE_ENV=production PORT=3000 STORAGE_LOCAL_DIR=/data/storage
EXPOSE 3000
CMD ["node", "scripts/serve.mjs"]
