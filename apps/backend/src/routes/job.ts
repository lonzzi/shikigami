import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { pollQbittorrent } from '../scheduler/jobs/qb-poll';
import { runRssSync } from '../scheduler/jobs/rss-sync';

/**
 * JobRun 审计 + 手动触发。
 */
export const job = new Hono()
  .get('/', async (c) => {
    const list = await prisma.jobRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return c.json(list);
  })
  .get('/:id', async (c) => {
    const j = await prisma.jobRun.findUnique({ where: { id: c.req.param('id') } });
    if (!j) return c.json({ error: 'not_found' }, 404);
    return c.json(j);
  })
  .post('/:kind/run', async (c) => {
    const kind = c.req.param('kind');
    // 异步触发，不等结果
    (async () => {
      try {
        if (kind === 'rss-sync') await runRssSync();
        else if (kind === 'qb-poll') await pollQbittorrent();
      } catch {
        /* 调用方顶层已记 JobRun */
      }
    })();
    return c.json({ ok: true, kind, status: 'triggered' });
  });
