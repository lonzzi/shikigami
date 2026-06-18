import { Hono } from 'hono';
import { searchSubjects } from '../metadata/bangumi';
import { searchTv, tmdbConfigured } from '../metadata/tmdb';

/**
 * 元数据直查路由（不落库）。
 */
export const metadata = new Hono()
  .get('/bangumi/search', async (c) => {
    const keyword = c.req.query('keyword');
    if (!keyword) return c.json({ error: 'keyword required' }, 400);
    return c.json(await searchSubjects(keyword));
  })
  .get('/tmdb/search', async (c) => {
    const keyword = c.req.query('keyword');
    if (!keyword) return c.json({ error: 'keyword required' }, 400);
    try {
      return c.json(await searchTv(keyword));
    } catch (e) {
      return c.json({ error: 'tmdb_unavailable', message: (e as Error).message }, 502);
    }
  })
  .get('/tmdb/status', async (c) => {
    // 配置探活：key 是否配置 + 一次轻量 searchTv 探活（命中即 healthy）。
    // 前端用这个决定是否显示「TMDB 不可用」告警。
    if (!tmdbConfigured()) return c.json({ configured: false, reachable: false });
    try {
      const hits = await searchTv('test');
      return c.json({ configured: true, reachable: true, sampleCount: hits.length });
    } catch (e) {
      return c.json({ configured: true, reachable: false, message: (e as Error).message });
    }
  });
