import { RetryableError } from '../lib/errors';
import { logger } from '../logger';
import type { MediaServerClient } from './types';

/**
 * Emby 客户端（架构 5.3 / 风险表 "Jellyfin vs Emby API 差异"）。
 *
 * 认证: X-Emby-Token header（兼容 ?api_key= query）。本实现用 header，避免 token 进日志 URL。
 * Emby 路径前缀通常是 /emby，但架构明确 "Jellyfin 不再兼容 /emby/ 前缀"，
 * Emby 侧仍需 /emby 前缀，由调用方在 base 里带上（如 http://emby:8096/emby）。
 *
 * 三级降级链与 Jellyfin 一致（API 形态兼容），仅认证方式不同。
 */
export class EmbyClient implements MediaServerClient {
  readonly type = 'emby' as const;

  constructor(
    private readonly base: string,
    private readonly apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      'X-Emby-Token': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  async refreshSeries(series: {
    tvdbId?: number | null;
    libraryPath?: string | null;
  }): Promise<void> {
    try {
      // 降级 1: 按系列（tvdbId）
      if (series.tvdbId) {
        const r = await fetch(`${this.base}/Library/Series/Updated`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ tvdbId: series.tvdbId }),
        });
        if (r.ok) return;
        logger.debug(
          { status: r.status, tvdbId: series.tvdbId },
          'emby Series/Updated non-ok, falling back',
        );
      }

      // 降级 2: 按路径
      if (series.libraryPath) {
        const r = await fetch(`${this.base}/Library/Media/Updated`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ Updates: [{ Path: series.libraryPath }] }),
        });
        if (r.ok) return;
        logger.debug(
          { status: r.status, path: series.libraryPath },
          'emby Media/Updated non-ok, falling back',
        );
      }

      // 降级 3: 全量（需 admin）
      const r = await fetch(`${this.base}/Library/Refresh`, {
        method: 'POST',
        headers: this.headers(),
      });
      if (!r.ok) {
        throw new Error(`Emby refresh HTTP ${r.status}`);
      }
    } catch (e) {
      throw new RetryableError(`Emby refresh failed: ${(e as Error).message}`);
    }
  }

  /**
   * 健康检查: GET /System/Info（Emby 通用）。
   * @returns true=可达且 token 有效
   */
  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/System/Info`, {
        method: 'GET',
        headers: { 'X-Emby-Token': this.apiKey },
      });
      return r.ok;
    } catch {
      return false;
    }
  }
}
