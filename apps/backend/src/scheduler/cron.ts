import { env } from '../lib/env';
import { logger } from '../logger';
import { pollQbittorrent } from './jobs/qb-poll';
import { runRssSync } from './jobs/rss-sync';

/**
 * 定时调度（架构 5.4 cron.ts）。
 *
 * 用 setInterval 实现（不依赖 Bun.cron 的模块路径模式），更可控、易测。
 * - RSS 同步: 按 env.RSS_SYNC_INTERVAL（cron 表达式, lib/env 已校验格式）折算为分钟间隔。
 *   简化策略: 解析 cron 的"分钟"字段得到间隔分钟数（形如 星号斜杠N 映射为 N 分钟, 否则 15 分钟）。
 * - qB 轮询: env.QB_POLL_INTERVAL_SECONDS 秒。
 *
 * 单次抛错只记日志，不崩进程（顶层 try/catch）。间隔器句柄存模块级，优雅关闭时可清。
 */

const timers: ReturnType<typeof setInterval>[] = [];
let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  const rssIntervalMs = Math.max(60_000, parseCronToMs(env.RSS_SYNC_INTERVAL));
  timers.push(
    setInterval(async () => {
      try {
        await runRssSync();
      } catch (e) {
        logger.error({ job: 'rss-sync', err: (e as Error).message }, 'cron failed');
      }
    }, rssIntervalMs),
  );

  const qbIntervalMs = Math.max(5, env.QB_POLL_INTERVAL_SECONDS) * 1000;
  timers.push(
    setInterval(async () => {
      try {
        await pollQbittorrent();
      } catch (e) {
        logger.error({ job: 'qb-poll', err: (e as Error).message }, 'cron failed');
      }
    }, qbIntervalMs),
  );

  logger.info({ rssIntervalMs, qbIntervalMs }, 'scheduler started (setInterval)');
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  started = false;
}

/** 把 cron 分钟字段折算为毫秒间隔（保守: 星号斜杠15 映射 15min, 星号斜杠30 映射 30min, 纯数字按该分钟; 其余 15min）。 */
function parseCronToMs(expr: string): number {
  const minuteField = expr.trim().split(/\s+/)[0] ?? '';
  const m = minuteField.match(/^\*\/(\d+)$/);
  if (m?.[1]) {
    return Math.max(1, Number(m[1])) * 60 * 1000;
  }
  if (/^\d+$/.test(minuteField)) {
    // 纯数字 = "每小时的第 N 分钟" → 间隔近似 1 小时（不在毫秒级精确还原 cron 语义）
    return 60 * 60 * 1000;
  }
  return 15 * 60 * 1000;
}
