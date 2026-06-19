import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { enqueueScrape } from '../scheduler/queues';

/**
 * 媒体库路由。
 */
export const library = new Hono()
  .get('/', async (c) => {
    // 按 series 聚合 MediaFile
    const series = await prisma.series.findMany({
      where: { mediaFiles: { some: {} } },
      orderBy: { updatedAt: 'desc' },
      include: {
        // episodes 是去重后的真实集数（每集一行）；mediaFiles 是原始文件数（含字幕/重复版本）
        _count: { select: { mediaFiles: true, episodes: true } },
        mediaFiles: { where: { kind: 'video' }, take: 1 },
      },
    });
    return c.json(series);
  })
  .get('/:id', async (c) => {
    const s = await prisma.series.findUnique({
      where: { id: c.req.param('id') },
      include: {
        mediaFiles: { orderBy: { createdAt: 'desc' } },
        episodes: { orderBy: { epInSeason: 'asc' } },
      },
    });
    if (!s) return c.json({ error: 'not_found' }, 404);
    return c.json(s);
  })
  .post('/:id/rescrape', async (c) => {
    const force = c.req.query('force') === 'true';
    const where = force
      ? { seriesId: c.req.param('id'), kind: 'video' }
      : {
          seriesId: c.req.param('id'),
          kind: 'video',
          scrapeState: { in: ['PENDING', 'FAILED', 'MATCHED'] },
        };
    const files = await prisma.mediaFile.findMany({ where });
    for (const f of files) {
      if (force) {
        await prisma.mediaFile.update({ where: { id: f.id }, data: { scrapeState: 'PENDING' } });
      }
      enqueueScrape(f.id);
    }
    return c.json({ ok: true, queued: files.length });
  });
