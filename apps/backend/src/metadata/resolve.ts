import { prisma } from '../lib/prisma';
import { logger } from '../logger';
import { searchSubjects } from './bangumi';
import { getTv, imageUrl, searchTv, type TmdbSeason } from './tmdb';

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
      // seasonOffset: 每季首集的绝对集号（字幕组连续编号时用）。{ [seasonNumber]: firstAbs }
      // 按 TMDB 季顺序累加 episodeCount（跳过 specials season 0）。best-effort，分cour/合并季可能不准。
      const seasonOffset = computeSeasonOffset(detail.seasons);
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
        ...(seasonOffset ? { seasonOffset: JSON.stringify(seasonOffset) } : {}),
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

/**
 * 按 TMDB 季结构计算 seasonOffset：{ [seasonNumber]: 该季首集绝对集号 }。
 * 字幕组常用「全剧连续绝对编号」（S1E12 之后 S2E1 = abs13），此函数按 TMDB 每季 episodeCount 累加。
 * - 跳过 season 0（Specials）
 * - best-effort：分 cour / 字幕组按季独立编号 / TMDB 合并季 时不准，需 EpisodeOverride 人工校正
 * 返回 null 表示无可用季结构（保留原 seasonOffset 不动）。
 */
function computeSeasonOffset(seasons: TmdbSeason[] | undefined): Record<string, number> | null {
  if (!seasons || seasons.length === 0) return null;
  const regular = seasons
    .filter((s) => s.seasonNumber >= 1 && s.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  if (regular.length <= 1) return null; // 单季不需要 offset
  const out: Record<string, number> = {};
  let abs = 1; // S1 首集 abs=1
  for (const s of regular) {
    out[String(s.seasonNumber)] = abs;
    abs += s.episodeCount;
  }
  return out;
}
