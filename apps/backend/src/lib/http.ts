import { logger } from '../logger';

export interface HttpGetOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Record<string, unknown> | string;
  retries?: number;
  /** 退避: 'exp' 指数 + 抖动 */
  backoff?: 'exp' | 'fixed';
  /** 按状态码决定策略: retry / fail / circuit */
  onStatus?: (status: number) => 'retry' | 'fail' | 'circuit';
  timeoutMs?: number;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** 站点抓取/外部 API 通用 HTTP。架构评审: 403 触发熔断, 5xx 重试, 4xx 直接失败。 */
export async function httpGet(url: string, opts: HttpGetOptions = {}): Promise<string> {
  const {
    method = 'GET',
    headers = {},
    body,
    retries = 3,
    backoff = 'exp',
    onStatus,
    timeoutMs = 30_000,
  } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers: { 'User-Agent': DEFAULT_UA, ...headers },
      };
      if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!headers['Content-Type'])
          (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
      const res = await fetch(url, { ...init, ...(proxy ? { proxy } : {}) });
      clearTimeout(timer);

      if (res.ok) return res.text();

      const policy = onStatus?.(res.status);
      if (policy === 'circuit') {
        throw new CircuitOpenError(`${url} → ${res.status}`);
      }
      if (policy === 'retry' && attempt < retries) {
        await sleep(backoffDelay(attempt, backoff));
        continue;
      }
      // 默认: 5xx 重试, 4xx 直接失败
      if (res.status >= 500 && attempt < retries) {
        await sleep(backoffDelay(attempt, backoff));
        continue;
      }
      throw new HttpError(`${url} → HTTP ${res.status}`, res.status);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof CircuitOpenError || e instanceof HttpError) throw e;
      // 网络错误: abort / ECONNRESET / ETIMEDOUT → 重试
      const msg = String((e as Error)?.message ?? e);
      if (attempt < retries && /abort|timeout|reset|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) {
        logger.debug({ url, attempt, msg }, 'http retry');
        await sleep(backoffDelay(attempt, backoff));
        continue;
      }
      throw new HttpError(`fetch failed: ${msg}`, 0);
    }
  }
  throw new HttpError(`${url} → exhausted retries`, 0);
}

function backoffDelay(attempt: number, mode: 'exp' | 'fixed'): number {
  const base = mode === 'exp' ? Math.min(30_000, 1000 * 2 ** attempt) : 1000;
  return base + Math.floor(Math.random() * 500);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
