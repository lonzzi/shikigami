import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';

/**
 * HTTP 请求日志中间件。记录 method/path/status/耗时 + requestId。
 */
export const httpLogger = (): MiddlewareHandler => async (c, next) => {
  const start = Date.now();
  const requestId = c.get('requestId') ?? '-';
  await next();
  const ms = Date.now() - start;
  const status = c.res.status;
  const line = logger.child({ requestId });
  if (status >= 500) line.error({ method: c.req.method, path: c.req.path, status, ms }, 'http');
  else if (status >= 400) line.warn({ method: c.req.method, path: c.req.path, status, ms }, 'http');
  else line.info({ method: c.req.method, path: c.req.path, status, ms }, 'http');
};
