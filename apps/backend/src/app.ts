import './lib/bigint-json';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { httpLogger } from './middleware/logger';
import { requestId } from './middleware/requestId';
import { auth } from './routes/auth';
import { feed } from './routes/feed';
import { health } from './routes/health';
import { job } from './routes/job';
import { library } from './routes/library';
import { metadata } from './routes/metadata';
import { metricsRoute } from './routes/metrics';
import { override } from './routes/override';
import { qbittorrent } from './routes/qbittorrent';
import { scrape } from './routes/scrape';
import { series } from './routes/series';
import { settings } from './routes/settings';
import { subscription } from './routes/subscription';
import { task } from './routes/task';

/**
 * Hono 应用组合。
 * /api/health 公开; /api/auth/login 公开; 其余需鉴权。
 * 生产环境由 Bun.serveStatic 托管前端 dist（见 index.ts）。
 */
const api = new Hono()
  .use('*', requestId())
  .use('*', httpLogger())
  .use('*', errorHandler())
  .route('/health', health)
  .route('/auth', auth)
  // 鉴权分界线
  .use('*', authMiddleware())
  .route('/settings', settings)
  .route('/series', series)
  .route('/subscriptions', subscription)
  .route('/tasks', task)
  .route('/library', library)
  .route('/scrape', scrape)
  .route('/metadata', metadata)
  .route('/feed', feed)
  .route('/qb', qbittorrent)
  .route('/jobs', job)
  .route('/metrics', metricsRoute)
  .route('/overrides', override);

export const app = new Hono()
  .use('/api/*', cors({ origin: (origin) => origin, credentials: true }))
  .route('/api', api);

/** 前端静态资源托管（生产; SPA fallback）。 */
export const staticApp = new Hono().use(
  '/*',
  serveStatic({ root: './public', rewriteRequestPath: (p) => (p === '/' ? '/index.html' : p) }),
);

export type AppType = typeof app;
