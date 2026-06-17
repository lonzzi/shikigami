# syntax=docker/dockerfile:1
# ============================================================
# Shikigami 多阶段构建
#   web-build:    构建前端 dist
#   backend-build: prisma generate + 后端依赖（含 @prisma/client 运行时）
#   runtime:      精简运行镜像，USER 1000:1000，entrypoint 跑 migrate
# 架构评审 I9: build 与 CMD 一致（bun run dist/index.js）。
# ============================================================

# ---------- Stage 1: 前端构建 ----------
FROM oven/bun:1.3 AS web-build
WORKDIR /app
# 整个 repo 拷进来, 保证 catalog/workspace 解析完整, vite 等 devDeps 能装
COPY . .
RUN bun install
WORKDIR /app/apps/web
RUN bun run build

# ---------- Stage 2: 后端构建（依赖 + prisma generate） ----------
FROM oven/bun:1.3 AS backend-build
WORKDIR /app
COPY . .
WORKDIR /app/apps/backend
RUN bun install
# prisma generate 需要 schema
RUN bunx prisma generate

# ---------- Stage 3: 运行时 ----------
FROM oven/bun:1.3 AS runtime
WORKDIR /app
USER 1000:1000

# 拷贝后端源码 + 生成的 prisma client + migration
COPY --from=backend-build /app/apps/backend/src ./apps/backend/src
COPY --from=backend-build /app/apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY --from=backend-build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=backend-build /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=backend-build /app/apps/backend/generated ./apps/backend/generated
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/apps/backend/node_modules ./apps/backend/node_modules

# 拷贝前端构建产物（由后端 serveStatic 托管）
COPY --from=web-build /app/apps/web/dist ./apps/backend/public

# 拷贝 workspace 根配置（pnpm catalog 解析需要）
COPY --from=backend-build /app/pnpm-workspace.yaml /app/package.json ./

WORKDIR /app/apps/backend
ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
