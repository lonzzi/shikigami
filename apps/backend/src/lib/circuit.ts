import { logger } from '../logger';

/**
 * 简单熔断器: 连续 N 次失败 → 冷却 X 分钟。
 * 架构评审: dmhy 403 / 站点挂了不要重试到死。
 */
interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const states = new Map<string, CircuitState>();

export interface CircuitOptions {
  threshold?: number;
  cooldownMs?: number;
}

const DEFAULTS: Required<CircuitOptions> = { threshold: 5, cooldownMs: 15 * 60 * 1000 };

/** 检查熔断器是否允许通过。true=放行, false=熔断中。 */
export function canPass(key: string, opts: CircuitOptions = {}): boolean {
  const { cooldownMs } = { ...DEFAULTS, ...opts };
  const s = states.get(key);
  if (!s || s.openedAt === null) return true;
  if (Date.now() - s.openedAt > cooldownMs) {
    // 半开: 允许一次尝试
    states.set(key, { failures: 0, openedAt: null });
    return true;
  }
  return false;
}

export function recordSuccess(key: string) {
  states.set(key, { failures: 0, openedAt: null });
}

export function recordFailure(key: string, opts: CircuitOptions = {}) {
  const { threshold } = { ...DEFAULTS, ...opts };
  const s = states.get(key) ?? { failures: 0, openedAt: null };
  s.failures += 1;
  if (s.failures >= threshold && s.openedAt === null) {
    s.openedAt = Date.now();
    logger.warn({ circuit: key, threshold }, 'circuit opened');
  }
  states.set(key, s);
}

/** 包裹一个 async 调用，自动记录成功/失败并门控。 */
export async function withCircuit<T>(
  key: string,
  fn: () => Promise<T>,
  opts: CircuitOptions = {},
): Promise<T> {
  if (!canPass(key, opts)) {
    throw new Error(`circuit_open:${key}`);
  }
  try {
    const r = await fn();
    recordSuccess(key);
    return r;
  } catch (e) {
    recordFailure(key, opts);
    throw e;
  }
}
