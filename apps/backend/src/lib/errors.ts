/** 跨模块复用的领域错误类型。调度层据此区分重试策略。 */

/** 可重试错误: 限流/网络/超时/截断。调度层指数退避重试。 */
export class RetryableError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RetryableError';
    this.cause = cause;
  }
}

/** 需人工审核错误: schema 校验失败/AI 交叉验证不过。进人工队列, 不重试。 */
export class NeedsReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsReviewError';
  }
}

/** 预算/速率熔断: LLM 费用超日上限。 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/** 导入撞名冲突 (不同 inode 的 EEXIST 且 reject 策略)。 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** HTTP 状态错误 (来自 lib/http)。 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isRetryable(e: unknown): boolean {
  return e instanceof RetryableError || (e instanceof Error && e.name === 'RetryableError');
}
