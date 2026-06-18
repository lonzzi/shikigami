import { importFile } from '../../downloader/import';
import { env } from '../../lib/env';
import { BudgetExceededError, NeedsReviewError, RetryableError } from '../../lib/errors';
import { classifyFileKind, extOf } from '../../lib/path';
import { prisma } from '../../lib/prisma';
import type { AnimeMeta } from '../../llm/schema';
import { scrapeFilename } from '../../llm/scrape';
import { jobLogger } from '../../logger';
import { buildLibraryPath, metaForRename } from '../../media/rename';
import { mapAbsoluteToSeason } from '../../metadata/mapping';
import { resolveByTitle } from '../../metadata/resolve';
import { parse } from '../../parser/anitomy';
import { regexChinese } from '../../parser/regex-cn';

/**
 * AI 刮削作业（单 MediaFile）。
 *
 * 流程（架构 5.2 + 5.3）:
 *  1. 解析文件名 → anitomy + regex 预解析 → AI 仲裁 scrapeFilename
 *  2. 命中 series（按 title_hint 匹配 Series；找不到则置 MATCHED+needs_review 等人工）
 *  3. 绝对集 → 季集映射（EpisodeOverride 权威优先）
 *  4. buildLibraryPath + 硬链接 importFile → RENAMED
 *  5. confidence < 阈值 / needs_review → 留 REVIEWED(待人工)，不硬链接
 *
 * 错误策略:
 *  - RetryableError / BudgetExceeded → 重试（队列层）
 *  - NeedsReview → MediaFile.scrapeState=FAILED + scrapeError，不重试
 */
export async function runScrapeTask(mediaFileId: string): Promise<void> {
  const log = jobLogger('scrape', mediaFileId);
  const mf = await prisma.mediaFile.findUnique({ where: { id: mediaFileId } });
  if (!mf) throw new Error(`mediaFile ${mediaFileId} not found`);
  // REVIEWED/RENAMED 默认跳过（架构: force=true 才覆盖）
  if (
    mf.scrapeState === 'REVIEWED' ||
    mf.scrapeState === 'RENAMED' ||
    mf.scrapeState === 'EXPORTED'
  ) {
    return;
  }

  // 1. 解析 + AI 仲裁
  const pre = parse(mf.fileName) ?? regexChinese(mf.fileName) ?? undefined;
  let meta;
  try {
    meta = await scrapeFilename(mf.fileName, pre ?? undefined, { mediaFileId });
  } catch (e) {
    if (e instanceof NeedsReviewError) {
      await prisma.mediaFile.update({
        where: { id: mediaFileId },
        data: { scrapeState: 'FAILED', scrapeError: e.message },
      });
      log.warn({ err: e.message }, 'needs review');
      return;
    }
    throw e; // Retryable / Budget → 队列重试
  }

  await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: { scrapeState: 'MATCHED', scrapeResult: JSON.stringify(meta), scrapedAt: new Date() },
  });

  // 2.5 解析 series: 优先继承 DownloadTask.seriesId, 否则按 title_hint 查/建 Series。
  //    无论置信度高低都先绑（低置信也预绑 TMDB 候选，让刮削确认页能显示归属；
  //    绑错可在人工 review 阶段修正）。绑不上留 null 等人工。
  const seriesId = await resolveSeries(mediaFileId, meta);
  if (!seriesId) {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { scrapeError: 'series_unresolved' },
    });
    log.warn('series unresolved, waiting for manual series binding');
  }

  // 3. 高置信且不待审 → 直接进入重命名；否则留 MATCHED 等人工（series 已预绑）
  if (meta.needs_review || meta.confidence < env.LLM_REVIEW_THRESHOLD) {
    log.info({ confidence: meta.confidence, seriesId }, 'low confidence, waiting for review');
    return;
  }
  if (!seriesId) return; // 上面已记 series_unresolved，低置信路径不再继续

  await renameAndLink(mediaFileId, meta);
}

/**
 * 解析 MediaFile 所属 Series（TMDB 优先对齐 + Bangumi 兜底）。
 * 1) 若 DownloadTask 已带 seriesId（订阅关联）→ 继承
 * 2) 否则按 meta.title_hint → resolveByTitle（TMDB 绑 tmdbId/tvdbId + Bangumi 补中文译名）
 * 3) 都失败 → 返回 null（留待人工）
 */
async function resolveSeries(mediaFileId: string, meta: AnimeMeta): Promise<string | null> {
  const mf = await prisma.mediaFile.findUnique({
    where: { id: mediaFileId },
    include: { downloadTask: true },
  });
  if (!mf) return null;

  // 1. 继承
  if (mf.downloadTask?.seriesId) {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { seriesId: mf.downloadTask.seriesId },
    });
    return mf.downloadTask.seriesId;
  }

  const hint = meta.title_hint?.trim();
  if (!hint) return null;

  // 2. 本地匹配（已绑过 tmdbId 的优先；再按标题模糊）
  const local = await prisma.series.findFirst({
    where: {
      OR: [
        { titleJp: { contains: hint } },
        { titleCn: { contains: hint } },
        { titleEn: { contains: hint } },
      ],
    },
  });
  if (local) {
    await prisma.mediaFile.update({ where: { id: mediaFileId }, data: { seriesId: local.id } });
    return local.id;
  }

  // 3. TMDB 优先查/建（带 tvdbId/tmdbId）+ Bangumi 兜底
  const result = await resolveByTitle(hint);
  if (result.seriesId) {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { seriesId: result.seriesId },
    });
    return result.seriesId;
  }
  return null;
}

/**
 * 重命名 + 硬链接到媒体库（RENAME 阶段）。
 * 单独导出供 /api/scrape/:id/review 人工确认后调用。
 */
export async function renameAndLink(mediaFileId: string, meta: AnimeMeta): Promise<void> {
  let mf = await prisma.mediaFile.findUnique({ where: { id: mediaFileId } });
  if (!mf) throw new Error(`mediaFile ${mediaFileId} not found`);
  // series 未解析 → 尝试解析（继承 DownloadTask 或按 title_hint 匹配/建）
  if (!mf.seriesId) {
    const resolved = await resolveSeries(mediaFileId, meta);
    if (!resolved) throw new Error('series not resolved, cannot rename');
    mf = (await prisma.mediaFile.findUnique({ where: { id: mediaFileId } }))!;
  }

  const series = await prisma.series.findUnique({ where: { id: mf.seriesId! } });
  if (!series) throw new Error('series missing');

  // 绝对集 → 季集
  const offsets = series.seasonOffset
    ? (JSON.parse(series.seasonOffset) as Record<string, number>)
    : {};
  const overridesRows = await prisma.episodeOverride.findMany({ where: { seriesId: series.id } });
  const overrides: Record<number, { season: number; episode: number }> = {};
  for (const o of overridesRows)
    overrides[o.absoluteNumber] = { season: o.season, episode: o.episode };

  const abs = meta.absolute_episode ?? meta.episode ?? 0;
  // abs<=0 表示 AI 没识别出集号，不能造 S01E01 假象 → 进人工
  if (abs <= 0) {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: { scrapeError: 'episode_not_resolved' },
    });
    throw new NeedsReviewError('absolute_episode and episode both null/zero');
  }
  const { season, episode } = mapAbsoluteToSeason(
    abs,
    offsets,
    (series.courMode as 'split' | 'absolute') ?? 'absolute',
    overrides,
  );

  // 找/建 Episode（按 series+season+epInSeason; 合集/类型差异可能多条,取第一条）
  let episodeRow = await prisma.episode.findFirst({
    where: { seriesId: series.id, seasonIndex: season, epInSeason: episode },
  });
  if (!episodeRow) {
    episodeRow = await prisma.episode.create({
      data: {
        seriesId: series.id,
        seasonIndex: season,
        epInSeason: episode,
        ep: episode,
        absoluteNumber: abs,
        type: 0,
      },
    });
  }

  const ext = extOf(mf.fileName);
  const kind = classifyFileKind(mf.fileName);
  const relPath = buildLibraryPath(
    { titleCn: series.titleCn ?? series.titleJp, year: series.year },
    { seasonIndex: season, epInSeason: episode, type: episodeRow.type ?? 0 },
    metaForRename(meta),
    ext,
    kind === 'subtitle' ? 'subtitle' : kind === 'font' ? 'font' : 'video',
  );
  const dstPath = `${env.LIBRARY_ROOT}/${relPath}`;

  await importFile(mf.sourcePath, dstPath, 'suffix');

  await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: { scrapeState: 'RENAMED', libraryPath: dstPath, episodeId: episodeRow.id },
  });
  jobLogger('scrape', mediaFileId).info({ dstPath }, 'renamed + linked');
}

export { BudgetExceededError, RetryableError };
