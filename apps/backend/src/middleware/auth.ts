import type { MiddlewareHandler } from 'hono';
import { verifyJwt } from '../lib/jwt';

/**
 * 鉴权中间件。校验 Authorization: Bearer <token>。
 * 健康检查 / 登录 / 公开 RSS 等路由跳过（在路由层调整顺序）。
 */
declare module 'hono' {
  interface ContextVariableMap {
    user: { sub: string };
  }
}

export const authMiddleware = (): MiddlewareHandler => async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = header.slice(7);
  const payload = verifyJwt(token);
  if (!payload) {
    return c.json({ error: 'unauthorized', message: 'invalid or expired token' }, 401);
  }
  c.set('user', { sub: payload.sub });
  await next();
};
