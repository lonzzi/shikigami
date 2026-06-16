import type { MiddlewareHandler } from 'hono';

/**
 * 请求 id 中间件: 每个请求注入 c.var.requestId。
 * 透传上游 X-Request-Id，否则用 crypto.randomUUID 生成（Bun/Node 18+ 原生）。
 */
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

export const requestId = (): MiddlewareHandler => async (c, next) => {
  const id = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
};
