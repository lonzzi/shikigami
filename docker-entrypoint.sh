#!/bin/sh
set -e

# 架构评审 I9: 启动前跑 prisma migrate deploy，确保 schema 同步。
# DATABASE_URL 由 env 提供（file:/data/shikigami.db）。
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] running prisma migrate deploy…"
  bunx prisma migrate deploy || echo "[entrypoint] WARN: migrate deploy failed, continuing"
fi

echo "[entrypoint] starting shikigami…"
exec "$@"
