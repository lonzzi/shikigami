import { Hono } from 'hono';
import { searchSubjects } from '../metadata/bangumi';
import { searchTv } from '../metadata/tmdb';

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
  });
