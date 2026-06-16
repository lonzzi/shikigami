import { existsSync } from 'node:fs';
import { app, staticApp } from './app';
import { env } from './lib/env';
import { logger } from './logger';
import { startScheduler } from './scheduler/cron';
import { reconcileStartup } from './scheduler/reconcile';
import { gracefulShutdown } from './scheduler/shutdown';

/**
 * 应用入口。
 *
 * 生命周期:
 *  1. Bun.serve（API + 前端静态托管 + SPA fallback）
 *  2. reconcileStartup（断点续跑未完成任务）
 *  3. startScheduler（cron 注册）
 *  4. SIGTERM/SIGINT → gracefulShutdown（pause 队列 → drain → WAL checkpoint → 关 DB）
 *  5. unhandledRejection/uncaughtException → 记录 + 优雅退出（容器 restart 接管）
 */
const hasFrontend = existsSync('./public/index.html');

const server = Bun.serve({
  port: env.PORT,
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 200,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api')) {
      return app.fetch(req, srv);
    }
    if (hasFrontend) {
      return staticApp.fetch(req, srv);
    }
    return new Response('Shikigami API. Frontend not built. See /api/health', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
});

logger.info({ port: env.PORT, frontend: hasFrontend }, 'server listening');

// 启动后台（不阻塞; 失败仅告警不崩）
reconcileStartup().catch((e) => logger.error({ err: (e as Error).message }, 'reconcile failed'));
startScheduler();

process.on('SIGTERM', () => {
  gracefulShutdown(server).finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  gracefulShutdown(server).finally(() => process.exit(0));
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'uncaughtException → graceful shutdown');
  gracefulShutdown(server).finally(() => process.exit(1));
});

export { server };
