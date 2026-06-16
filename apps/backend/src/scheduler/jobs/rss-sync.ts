import { addMagnet } from '../../downloader/qbittorrent';
import { env } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { jobLogger } from '../../logger';
import { registry } from '../../scrapers';
import type { FilterRule, Torrent } from '../../scrapers/types';
import { matchAndRank } from '../matchEngine';

/**
 * RSS 同步作业（架构 2.2 数据流入口）。
 *
 * 设计（架构修订）:
 *  - 所有订阅的 dmhy 抓取合并到一次 cron 周期: 先拉全站 RSS 再内存匹配（单站全局并发=1）。
 *  - MagnetSeen 跨订阅磁链去重；命中且未 invalidated → 跳过。
 *  - 命中且新增 → 写 DownloadTask + 投 qBittorrent。
 *  - 更新 subscription.lastSeenPubDate / lastMatchCount / lastRunAt。
 */
export async function runRssSync(): Promise<void> {
  const log = jobLogger('rss-sync');
  const subs = await prisma.subscription.findMany({ where: { enabled: true, paused: false } });
  if (subs.length === 0) {
    log.info('no active subscriptions, skip');
    return;
  }

  // 按站点聚合抓取需求: 每个站点只拉必要的 RSS，避免重复请求
  const fetchPlan = planFetches(subs);
  const allTorrents = await fetchAll(fetchPlan);
  log.info(
    { subs: subs.length, sources: fetchPlan.size, items: allTorrents.length },
    'rss fetched',
  );

  let totalMatched = 0;
  for (const sub of subs) {
    const rule = parseRule(sub.filterRule);
    if (!rule) continue;
    const matched = matchAndRank(
      allTorrents.filter((t) => rule.sources.includes(t.source)),
      rule,
    );
    let matchCount = 0;
    for (const m of matched) {
      const placed = await tryEnqueue(
        sub.id,
        m.torrent,
        sub.category ?? env.QBT_CATEGORY_DEFAULT,
        sub.seriesId ?? null,
      );
      if (placed) matchCount += 1;
    }
    totalMatched += matchCount;
    const latestPub = latestPubDate(matched.map((m) => m.torrent));
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        lastRunAt: new Date(),
        lastMatchCount: matchCount,
        ...(latestPub ? { lastSeenPubDate: latestPub } : {}),
      },
    });
  }
  log.info({ totalMatched }, 'rss-sync done');
}

/** 单订阅的 RSS 抓取（手动触发 /api/subscriptions/:id/run 复用）。 */
export async function runSubscriptionRss(subscriptionId: string): Promise<{ matched: number }> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new Error('subscription not found');
  const rule = parseRule(sub.filterRule);
  if (!rule) return { matched: 0 };

  const torrents = await fetchForRule(rule);
  const matched = matchAndRank(torrents, rule);
  let count = 0;
  for (const m of matched) {
    if (
      await tryEnqueue(
        sub.id,
        m.torrent,
        sub.category ?? env.QBT_CATEGORY_DEFAULT,
        sub.seriesId ?? null,
      )
    )
      count += 1;
  }
  const latestPub = latestPubDate(matched.map((m) => m.torrent));
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      lastRunAt: new Date(),
      lastMatchCount: count,
      ...(latestPub ? { lastSeenPubDate: latestPub } : {}),
    },
  });
  return { matched: count };
}

// ============================================================
// 抓取计划
// ============================================================

/** 按站点聚合: { source → Set<keyword|teamId|latest> } */
function planFetches(subs: { filterRule: string }[]): Map<string, Set<string>> {
  const plan = new Map<string, Set<string>>();
  for (const s of subs) {
    const rule = parseRule(s.filterRule);
    if (!rule) continue;
    for (const src of rule.sources) {
      if (!plan.has(src)) plan.set(src, new Set());
      const bag = plan.get(src)!;
      bag.add('latest'); // 总是拉最新 RSS
      if (rule.keyword) bag.add(`kw:${rule.keyword}`);
      for (const tid of rule.teamIds ?? []) bag.add(`team:${tid}`);
    }
  }
  return plan;
}

async function fetchAll(plan: Map<string, Set<string>>): Promise<Torrent[]> {
  const out: Torrent[] = [];
  for (const [src, bag] of plan) {
    const adapter = registry[src as keyof typeof registry];
    if (!adapter) continue;
    try {
      // 拉最新
      if (bag.has('latest')) out.push(...(await adapter.fetchLatest()));
      // 按关键词
      for (const key of bag) {
        if (key.startsWith('kw:')) out.push(...(await adapter.fetchByKeyword(key.slice(3))));
        if (key.startsWith('team:') && adapter.fetchByTeam)
          out.push(...(await adapter.fetchByTeam(key.slice(5))));
      }
    } catch (e) {
      jobLogger('rss-sync', src).warn({ err: (e as Error).message }, 'source fetch failed');
    }
  }
  return out;
}

async function fetchForRule(rule: FilterRule): Promise<Torrent[]> {
  const out: Torrent[] = [];
  for (const src of rule.sources) {
    const adapter = registry[src];
    if (!adapter) continue;
    try {
      out.push(...(await adapter.fetchLatest()));
      if (rule.keyword) out.push(...(await adapter.fetchByKeyword(rule.keyword)));
      if (rule.teamIds)
        for (const tid of rule.teamIds)
          if (adapter.fetchByTeam) out.push(...(await adapter.fetchByTeam(tid)));
    } catch (e) {
      jobLogger('rss-sync', src).warn({ err: (e as Error).message }, 'source fetch failed');
    }
  }
  return out;
}

// ============================================================
// 去重 + 入队
// ============================================================

/** 返回 true 表示新放入 qB；false 表示重复跳过。 */
async function tryEnqueue(
  subscriptionId: string,
  t: Torrent,
  category: string,
  seriesId: string | null,
): Promise<boolean> {
  if (!t.infoHash) return false;

  // MagnetSeen 去重（跨订阅）
  const seen = await prisma.magnetSeen.findUnique({ where: { infoHash: t.infoHash } });
  if (seen && !seen.invalidated) return false;

  // 下载磁盘预检失败则标 PENDING_DISK_FULL，不投 qB（避免 qB 报错循环）
  const result = await addMagnet(t.magnet ?? `magnet:?xt=urn:btih:${t.infoHash}`, { category });
  if (result === 'failed') {
    jobLogger('rss-sync').warn({ infoHash: t.infoHash, title: t.title }, 'addMagnet failed');
    return false;
  }

  // 写 DownloadTask（捕获 id 用于回填 MagnetSeen.downloadTaskId）
  const task = await prisma.downloadTask.upsert({
    where: { infoHash: t.infoHash },
    create: {
      subscriptionId,
      seriesId,
      infoHash: t.infoHash,
      source: t.source,
      sourceItemId: t.sourceItemId || null,
      magnet: t.magnet ?? null,
      torrentUrl: t.torrentFileUrl ?? null,
      rawTitle: t.title,
      fansub: t.fansub ?? null,
      subtitleLang: t.subtitleLang ?? null,
      sizeBytes: t.size ?? 0n,
      pubDate: t.pubDate ?? null,
      status: 'DOWNLOADING',
      hash: t.infoHash,
    },
    // update 不覆盖 subscriptionId（保留原订阅归属，避免"最近订阅"抢占）
    update: { status: 'DOWNLOADING' },
  });
  await prisma.magnetSeen.upsert({
    where: { infoHash: t.infoHash },
    create: {
      infoHash: t.infoHash,
      source: t.source,
      sourceItemId: t.sourceItemId || null,
      downloadTaskId: task.id,
    },
    update: { invalidated: false, downloadTaskId: task.id },
  });
  return true;
}

// ============================================================
// 辅助
// ============================================================

export function parseRule(json: string): FilterRule | null {
  try {
    const r = JSON.parse(json) as FilterRule;
    if (!r.sources || r.sources.length === 0) return null;
    return r;
  } catch {
    return null;
  }
}

function latestPubDate(torrents: Torrent[]): Date | null {
  const dates = torrents.map((t) => t.pubDate?.getTime() ?? 0).filter((x) => x > 0);
  return dates.length ? new Date(Math.max(...dates)) : null;
}
