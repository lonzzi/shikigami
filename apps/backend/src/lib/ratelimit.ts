import pLimit from 'p-limit';

/**
 * 各站点/API 独立限流令牌桶。
 * 架构评审: bgm.tv ≤1 req/s, dmhy 单站并发=1。
 */
export const siteLimiters = {
  dmhy: pLimit(1),
  mikan: pLimit(1),
  nyaa: pLimit(1),
  bangumimoe: pLimit(1),
} as const;

export type SiteKey = keyof typeof siteLimiters;

/** Bangumi API 限流: 1 req/s。用单并发 + 最小间隔实现。 */
const bangumiLimit = pLimit(1);
let lastBangumiCall = 0;

export async function bangumiThrottle<T>(fn: () => Promise<T>): Promise<T> {
  return bangumiLimit(async () => {
    const elapsed = Date.now() - lastBangumiCall;
    const min = 1000;
    if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed));
    lastBangumiCall = Date.now();
    return fn();
  });
}

/** TMDB: 较宽松, 4 req/s。 */
export const tmdbLimit = pLimit(4);
