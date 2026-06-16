# @shikigami/web

Vite + React 前端 (SPA), 生产构建产物由后端托管。

## 技术栈

- **React 19** + TypeScript
- **Vite** 构建
- **TanStack Router** (编程式路由) + **TanStack Query** (数据获取)
- **Tailwind v4** + 自研 UI 组件 (和风亮色主题)
- **hono/client** RPC (类型安全的后端调用)
- **Sonner** 全局通知

## 页面结构

```
src/
├── main.tsx          # 入口: QueryClient (401 全局拦截) + RouterProvider
├── routes.tsx        # 路由树 (登录守卫: 未登录 redirect)
├── components/
│   ├── AppLayout.tsx # 侧栏布局 (分组导航 + 印章 logo)
│   └── ui/           # button / primitives (Card/Badge/Input/EmptyState/...)
├── lib/
│   ├── api.ts        # hono/client RPC + token 注入 + 401 拦截
│   └── utils.ts      # cn / formatBytes / formatDate
└── pages/
    ├── Login.tsx
    ├── Dashboard.tsx     # 仪表盘 (统计卡 + qB/任务/磁盘)
    ├── Subscriptions.tsx # 订阅 (搜索 + 自动关联番剧 + rebind)
    ├── Tasks.tsx         # 下载任务 (useInfiniteQuery 分页 + 滚动加载 + 订阅关联)
    ├── Library.tsx       # 媒体库
    ├── ScrapeReview.tsx  # AI 刮削确认 (试刮削 + 人工确认)
    └── Settings.tsx      # 设置 (敏感字段加密)
```

## 常用命令

```bash
bun run dev       # Vite dev (http://localhost:5173, 代理 /api → 后端 :3000)
bun run build     # 生产构建 → dist/ (拷贝到 backend/public 托管)
bun run typecheck
```

## 设计

- **主题**: 和纸米白背景 + 朱色 (神社朱红) 主色 + 桜色点缀, 毛笔体 logo
- **交互**: 所有操作走 Sonner toast (loading → success/error), 卡片悬浮微动效
- **健壮性**: token 过期自动登出跳转, 滚动加载 IntersectionObserver
