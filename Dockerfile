# ============================================================
# Shikigami 多阶段构建
#   build:  node:22-slim (有 pnpm/openssl, 生成 prisma 多架构引擎)
#   runtime: oven/bun:1.3 (项目依赖 Bun 运行时)
# ============================================================

# ---------- Stage 1: 前端构建 ----------
FROM node:22-slim AS web-build
WORKDIR /app
COPY . .
RUN corepack enable pnpm
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile --ignore-scripts
WORKDIR /app/apps/web
RUN pnpm run build

# ---------- Stage 2: 后端构建 ----------
FROM node:22-slim AS backend-build
WORKDIR /app
COPY . .
RUN corepack enable pnpm
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile --ignore-scripts
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app/apps/backend
# prisma generate: schema 已加 binaryTargets=[native, openssl-3.0.x, openssl-1.1.x], 同时生成两个引擎
RUN npx prisma generate

# ---------- Stage 3: 运行时 (bun) ----------
FROM oven/bun:1.3 AS runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=backend-build /app/apps/backend/src ./apps/backend/src
COPY --from=backend-build /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=backend-build /app/apps/backend/generated ./apps/backend/generated
COPY --from=backend-build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=backend-build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=web-build /app/apps/web/dist ./apps/backend/public
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

WORKDIR /app/apps/backend
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
