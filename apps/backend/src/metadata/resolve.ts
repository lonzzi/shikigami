import { prisma } from '../lib/prisma';
import { logger } from '../logger';
import { searchSubjects } from './bangumi';
import { getTv, imageUrl, searchTv } from './tmdb';

/**
 * 标题 → Series 绑定（TMDB 优先 + Bangumi 补中文译名）。
 *
 * 流程（架构修订: TMDB 对齐）:
 *  1. TMDB /search/tv 搜 top-1 候选
 *  2. getTv 取详情: tmdbId / tvdbId / 季结构 / 海报 / 年份
 *  3. upsert Series（按 tmdbId）: 写入 tmdbId/tvdbId/titleEn/titleJp/year/poster/seasonCount
 *  4. Bangumi 搜 top-1 补 titleCn（中文译名）—— TMDB zh-CN 译名有时为空
 *  5. 任一源命中即返回 seriesId; 都失败返回 null（留人工）
 *
 * tmdbId/tvdbId 是 Jellyfin/Emby 刮削的权威 ID（它们默认 TMDB 元数据源）。
 */

export interface ResolveResult {
  seriesId: string | null;
  source: 'tmdb' | 'bangumi' | 'none';
  tmdbId?: number;
  tvdbId?: number;
}

export async function resolveByTitle(titleHint: string): Promise<ResolveResult> {
  const hint = titleHint.trim();
  if (!hint) return { seriesId: null, source: 'none' };

  // 1. TMDB 优先
  try {
    const tmdbHits = await searchTv(hint);
    if (tmdbHits.length > 0) {
      const top = tmdbHits[0]!;
      const detail = await getTv(top.id);
      // 2. Bangumi 补中文译名（best-effort，失败用 TMDB zh-CN name）
      let titleCn: string | null = null;
      try {
        const bgm = await searchSubjects(hint);
        if (bgm.length > 0 && bgm[0]!.name_cn) titleCn = bgm[0]!.name_cn;
      } catch {
        /* Bangumi 失败不阻塞 */
      }

      // tmdbId 在 schema 是 index 非 unique，用 findFirst + create/update（避免迁移）
      const existing = await prisma.series.findFirst({ where: { tmdbId: detail.id } });
      const data = {
        tmdbId: detail.id,
        tvdbId: detail.tvdbId ?? null,
        titleJp: detail.originalName || detail.name,
        titleEn: detail.name,
        titleCn: titleCn ?? (detail.name !== detail.originalName ? detail.name : null),
        year: detail.firstAirDate ? Number(detail.firstAirDate.slice(0, 4)) : null,
        seasonCount: detail.numberOfSeasons || 1,
        totalEpisodes: detail.numberOfEpisodes || null,
        posterUrl: imageUrl(detail.posterPath) ?? null,
        metadataRaw: JSON.stringify({ tmdb: detail }),
      };
      let series;
      if (existing) {
        series = await prisma.series.update({ where: { id: existing.id }, data });
      } else {
        series = await prisma.series.create({ data });
      }
      logger.debug(
        { seriesId: series.id, tmdbId: detail.id, tvdbId: detail.tvdbId },
        'series bound via TMDB',
      );
      return { seriesId: series.id, source: 'tmdb', tmdbId: detail.id, tvdbId: detail.tvdbId };
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message, hint }, 'TMDB resolve failed, fallback to Bangumi');
  }

  // 2. TMDB 无果 → Bangumi 建（无 tmdbId/tvdbId，后续可再补）
  try {
    const candidates = await searchSubjects(hint);
    if (candidates.length > 0) {
      const top = candidates[0]!;
      const series = await prisma.series.upsert({
        where: { bangumiId: top.id },
        create: { bangumiId: top.id, titleJp: top.name, titleCn: top.name_cn || null },
        update: {},
      });
      // 异步 best-effort 回填 TMDB（不阻塞主流程；失败静默）。
      // Bangumi-only Series 多半是 TMDB 当时限流/网络抖动没命中，事后补一次常有戏。
      void backfillTmdb(series.id).catch(() => {});
      return { seriesId: series.id, source: 'bangumi' };
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message, hint }, 'Bangumi resolve failed');
  }

  return { seriesId: null, source: 'none' };
}

/** 给已存在的 Series 回填缺失的 tmdbId/tvdbId（按 titleJp/titleEn 搜 TMDB）。 */
export async function backfillTmdb(seriesId: string): Promise<boolean> {
  const s = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!s || s.tmdbId) return false; // 已有 tmdbId 跳过
  const hint = s.titleEn ?? s.titleJp;
  if (!hint) return false;
  const r = await resolveByTitle(hint);
  if (r.source === 'tmdb' && r.seriesId) {
    // resolveByTitle 创建了新 Series；把原 Series 的关联数据迁移到 TMDB Series
    // 简化: 直接把 tmdbId/tvdbId 写到原 Series（若 TMDB 那条是空的草稿就删掉）
    if (r.seriesId !== seriesId) {
      const tmdbSeries = await prisma.series.findUnique({ where: { id: r.seriesId } });
      if (tmdbSeries) {
        await prisma.series.update({
          where: { id: seriesId },
          data: {
            tmdbId: tmdbSeries.tmdbId,
            tvdbId: tmdbSeries.tvdbId,
            posterUrl: tmdbSeries.posterUrl ?? undefined,
            year: tmdbSeries.year ?? undefined,
            metadataRaw: tmdbSeries.metadataRaw ?? undefined,
          },
        });
        // 删除 TMDB 草稿（如果它没有媒体文件关联）
        const hasMedia = await prisma.mediaFile.count({ where: { seriesId: tmdbSeries.id } });
        if (hasMedia === 0) await prisma.series.delete({ where: { id: tmdbSeries.id } });
      }
    }
    return true;
  }
  return false;
}
