import { RetryableError } from '../lib/errors';
import { logger } from '../logger';
import type { MediaServerClient } from './types';

/**
 * Jellyfin 客户端（架构 5.3 jellyfin.ts）。
 *
 * 认证: ?api_key= query 参数。
 * 触发扫描三级降级链（架构 I8 / ops 表 "tvdbId 缺失降级链"）:
 *   1. tvdbId 存在 → POST /Library/Series/Updated?tvdbId=xxx（首选，按系列增量）
 *   2. tvdbId 缺失 → POST /Library/Media/Updated body {Updates:[{Path}]}（按路径）
 *   3. 仍失败 → POST /Library/Refresh（需 admin，兜底全量）
 * 调用失败抛 RetryableError，调度层据此落 JobRun.error 并可重试。
 */
export class JellyfinClient implements MediaServerClient {
  readonly type = 'jellyfin' as const;

  constructor(
    private readonly base: string,
    private readonly apiKey: string,
  ) {}

  /** 拼带 api_key 的 URL。 */
  private url(path: string): string {
    const sep = path.includes('?') ? '&' : '?';
    return `${this.base}${path}${sep}api_key=${encodeURIComponent(this.apiKey)}`;
  }

  async refreshSeries(series: {
    tvdbId?: number | null;
    libraryPath?: string | null;
  }): Promise<void> {
    try {
      // 降级 1: 按系列（tvdbId）
      if (series.tvdbId) {
        const r = await fetch(this.url('/Library/Series/Updated'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tvdbId: series.tvdbId }),
        });
        if (r.ok) return;
        logger.debug(
          { status: r.status, tvdbId: series.tvdbId },
          'jellyfin Series/Updated non-ok, falling back',
        );
      }

      // 降级 2: 按路径
      if (series.libraryPath) {
        const r = await fetch(this.url('/Library/Media/Updated'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Updates: [{ Path: series.libraryPath }] }),
        });
        if (r.ok) return;
        logger.debug(
          { status: r.status, path: series.libraryPath },
          'jellyfin Media/Updated non-ok, falling back',
        );
      }

      // 降级 3: 全量（需 admin）
      const r = await fetch(this.url('/Library/Refresh'), { method: 'POST' });
      if (!r.ok) {
        throw new Error(`Jellyfin refresh HTTP ${r.status}`);
      }
    } catch (e) {
      // 架构: 调用失败必须落 JobRun.error 并可重试，绝不静默吞
      throw new RetryableError(`Jellyfin refresh failed: ${(e as Error).message}`);
    }
  }

  /**
   * 健康检查: GET /System/Ping（Jellyfin 通用）。
   * @returns true=可达
   */
  async ping(): Promise<boolean> {
    try {
      const r = await fetch(this.url('/System/Ping'), { method: 'GET' });
      return r.ok;
    } catch {
      return false;
    }
  }
}
