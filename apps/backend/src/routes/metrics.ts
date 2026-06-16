import { Hono } from 'hono';
import { getMetrics } from '../metrics';

/**
 * 仪表盘 metrics 路由（架构 I7）。
 */
export const metricsRoute = new Hono().get('/', async (c) => {
  return c.json(await getMetrics());
});
