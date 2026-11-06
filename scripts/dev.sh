#!/usr/bin/env bash
# One-command dev: start services (docker if available, else local postgres/redis),
# migrate, apply RLS, seed on first run, then `next dev`.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
set -a; source .env; set +a

if docker info >/dev/null 2>&1; then
  echo "▸ Starting docker services (postgres, redis, minio, mailpit)…"
  docker compose up -d --wait postgres redis mailpit minio
else
  echo "▸ Docker not available — using local services."
  (command -v service >/dev/null && { service postgresql start >/dev/null 2>&1 || true; service redis-server start >/dev/null 2>&1 || true; }) || true
fi

echo "▸ Waiting for Postgres…"
for i in $(seq 1 30); do
  node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 1
done

# Create the database if missing (local installs).
psql "${DATABASE_ADMIN_URL%/*}/postgres" -tc "SELECT 1 FROM pg_database WHERE datname='hearthstead'" 2>/dev/null | grep -q 1 \
  || psql "${DATABASE_ADMIN_URL%/*}/postgres" -c "CREATE DATABASE hearthstead" >/dev/null 2>&1 || true

echo "▸ Migrating + applying row-level security…"
pnpm -s prisma migrate deploy
pnpm -s tsx prisma/apply-rls.ts

if [ "$(psql "$DATABASE_ADMIN_URL" -tAc 'SELECT count(*) FROM "Organization"' 2>/dev/null || echo 0)" = "0" ]; then
  echo "▸ Seeding demo data…"
  pnpm -s db:seed
fi

exec pnpm -s next dev -p "${PORT:-3000}"
