import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { resolveByTitle } from '../metadata/resolve';
import { runSubscriptionRss } from '../scheduler/jobs/rss-sync';
import { matchAndRank } from '../scheduler/matchEngine';
import { getAdapter } from '../scrapers';
import type { FilterRule } from '../scrapers/types';

/**
 * 订阅路由。
 * filterRule 在 service 层用 zod 校验 sources 必填。
 */
const filterRuleSchema = z.object({
  sources: z.array(z.enum(['dmhy', 'mikan', 'nyaa', 'bangumimoe'])).min(1),
  keyword: z.string().optional(),
  teamIds: z.array(z.string()).optional(),
  sortId: z.string().optional(),
  resolutionMin: z.enum(['480p', '720p', '1080p', '2160p']).optional(),
  fansubs: z.array(z.string()).optional(),
  blacklist: z.array(z.string()).optional(),
  preferredLang: z.enum(['CHS', 'CHT', 'DUAL', 'ANY']).optional(),
  fallbackResolution: z.array(z.string()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  seriesId: z.string().optional(),
  enabled: z.boolean().default(true),
  filterRule: filterRuleSchema,
  category: z.string().default('动漫'),
  savePath: z.string().optional(),
  autoRename: z.boolean().default(true),
});

export const subscription = new Hono()
  .get('/', async (c) => {
    const search = c.req.query('search')?.trim().toLowerCase();
    const onlyLinked = c.req.query('linked') === 'true';
    const onlyUnlinked = c.req.query('linked') === 'false';
    const list = await prisma.subscription.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { series: true, _count: { select: { downloadTasks: true } } },
    });
    let result = list;
    if (search) {
      result = result.filter(
        (s: (typeof list)[number]) =>
          s.name.toLowerCase().includes(search) ||
          (s.series?.titleCn?.toLowerCase().includes(search) ?? false) ||
          (s.series?.titleJp.toLowerCase().includes(search) ?? false),
      );
    }
    if (onlyLinked) result = result.filter((s: (typeof list)[number]) => s.seriesId);
    if (onlyUnlinked) result = result.filter((s: (typeof list)[number]) => !s.seriesId);
    return c.json(result);
  })
  .post('/', zValidator('json', createSchema), async (c) => {
    const input = c.req.valid('json');
    // 自动关联 Series: 若未显式传 seriesId, 按 keyword 搜 TMDB/Bangumi 绑定
    let seriesId = input.seriesId;
    if (!seriesId) {
      const hint = input.filterRule.keyword ?? input.name;
      try {
        const r = await resolveByTitle(hint);
        if (r.seriesId) seriesId = r.seriesId;
      } catch {
        /* 解析失败不阻断创建 */
      }
    }
    const created = await prisma.subscription.create({
      data: {
        name: input.name,
        seriesId,
        enabled: input.enabled,
        filterRule: JSON.stringify(input.filterRule),
        category: input.category,
        savePath: input.savePath,
        autoRename: input.autoRename,
      },
      include: { series: true },
    });
    return c.json(created, 201);
  })
  .get('/:id', async (c) => {
    const sub = await prisma.subscription.findUnique({
      where: { id: c.req.param('id') },
      include: { series: true, downloadTasks: { orderBy: { addedAt: 'desc' }, take: 50 } },
    });
    if (!sub) return c.json({ error: 'not_found' }, 404);
    return c.json(sub);
  })
  .put('/:id', zValidator('json', createSchema.partial()), async (c) => {
    const input = c.req.valid('json');
    const data: Record<string, unknown> = { ...input };
    if (input.filterRule) data.filterRule = JSON.stringify(input.filterRule);
    const updated = await prisma.subscription.update({ where: { id: c.req.param('id') }, data });
    return c.json(updated);
  })
  // 重新关联 Series（按 keyword 搜 TMDB/Bangumi 绑定，给已存在的未关联订阅用）
  .post('/:id/rebind', async (c) => {
    const sub = await prisma.subscription.findUnique({ where: { id: c.req.param('id') } });
    if (!sub) return c.json({ error: 'not_found' }, 404);
    const rule = JSON.parse(sub.filterRule) as FilterRule;
    const hint = rule.keyword ?? sub.name;
    const r = await resolveByTitle(hint);
    if (!r.seriesId) return c.json({ error: 'series_not_found', hint }, 422);
    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { seriesId: r.seriesId },
      include: { series: true },
    });
    return c.json({ ok: true, seriesId: r.seriesId, series: updated.series, source: r.source });
  })
  .delete('/:id', async (c) => {
    // SetNull: 保留历史 DownloadTask
    await prisma.subscription.delete({ where: { id: c.req.param('id') } });
    return c.json({ ok: true });
  })
  .post('/:id/run', async (c) => {
    const { matched } = await runSubscriptionRss(c.req.param('id'));
    return c.json({ ok: true, matched });
  })
  .get('/:id/preview', async (c) => {
    const sub = await prisma.subscription.findUnique({ where: { id: c.req.param('id') } });
    if (!sub) return c.json({ error: 'not_found' }, 404);
    const rule = JSON.parse(sub.filterRule) as FilterRule;
    const items: import('../scrapers/types').Torrent[] = [];
    for (const src of rule.sources) {
      const adapter = getAdapter(src);
      try {
        if (rule.keyword) items.push(...(await adapter.fetchByKeyword(rule.keyword)));
        else items.push(...(await adapter.fetchLatest()));
      } catch {
        /* 单源失败继续 */
      }
    }
    const matched = matchAndRank(items, rule).slice(0, 50);
    return c.json({ total: items.length, matched });
  });
