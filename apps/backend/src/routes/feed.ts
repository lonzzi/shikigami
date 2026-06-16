import { Hono } from 'hono';
import { matchAndRank } from '../scheduler/matchEngine';
import { getAdapter } from '../scrapers';
import type { FilterRule } from '../scrapers/types';

/**
 * Feed 搜索路由: 跨站 RSS 实时搜索 + 预览匹配。
 * GET /feed/search?keyword=&source=dmhy&fansub=&limit=
 *   返回抓到的真实种子列表 (可选按字幕组过滤)
 */
export const feed = new Hono().get('/search', async (c) => {
  const keyword = c.req.query('keyword');
  if (!keyword?.trim()) return c.json({ error: 'keyword required' }, 400);
  const source = (c.req.query('source') ?? 'dmhy') as 'dmhy' | 'mikan' | 'nyaa' | 'bangumimoe';
  const fansub = c.req.query('fansub')?.trim();
  const limit = Number(c.req.query('limit') ?? 30);

  const adapter = getAdapter(source);
  if (!adapter) return c.json({ error: 'unknown source' }, 400);

  let torrents;
  try {
    torrents = await adapter.fetchByKeyword(keyword.trim());
  } catch (e) {
    return c.json({ error: 'fetch_failed', message: (e as Error).message }, 502);
  }

  // 可选字幕组过滤
  let result = torrents;
  if (fansub) {
    const rule: FilterRule = { sources: [source], keyword: keyword.trim(), fansubs: [fansub] };
    result = matchAndRank(torrents, rule).map((m) => m.torrent);
  }

  return c.json({
    source,
    keyword,
    total: torrents.length,
    matched: result.length,
    items: result.slice(0, limit).map((t) => ({
      title: t.title,
      fansub: t.fansub,
      subtitleLang: t.subtitleLang,
      infoHash: t.infoHash,
      hasMagnet: !!t.magnet,
      size: t.size?.toString() ?? null,
      pubDate: t.pubDate?.toISOString() ?? null,
    })),
  });
});
