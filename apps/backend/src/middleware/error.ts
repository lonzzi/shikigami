import type { MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { BudgetExceededError, ConflictError, isRetryable, NeedsReviewError } from '../lib/errors';
import { logger } from '../logger';

/**
 * 全局错误处理。把领域错误 / Zod 错误映射为统一 JSON 响应。
 * 未识别错误记 error 日志后返回 500，绝不泄露堆栈给客户端。
 */
export const errorHandler = (): MiddlewareHandler => async (c, next) => {
  try {
    await next();
  } catch (e) {
    const requestId = c.get('requestId') ?? '-';

    if (e instanceof ZodError) {
      return c.json({ error: 'validation_error', requestId, issues: e.issues }, 400);
    }
    if (e instanceof NeedsReviewError) {
      return c.json({ error: 'needs_review', requestId, message: e.message }, 422);
    }
    if (e instanceof ConflictError) {
      return c.json({ error: 'conflict', requestId, message: e.message }, 409);
    }
    if (e instanceof BudgetExceededError) {
      return c.json({ error: 'budget_exceeded', requestId, message: e.message }, 429);
    }
    if (isRetryable(e)) {
      logger.warn({ requestId, err: (e as Error).message }, 'retryable_error');
      return c.json({ error: 'retryable', requestId, message: (e as Error).message }, 503);
    }
    logger.error({ requestId, err: e instanceof Error ? e.message : String(e) }, 'unhandled_error');
    return c.json({ error: 'internal', requestId }, 500);
  }
};
