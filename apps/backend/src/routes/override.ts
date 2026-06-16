import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

/**
 * EpisodeOverride 路由: 人工修正的绝对集→季集映射。
 */
const createSchema = z.object({
  seriesId: z.string(),
  absoluteNumber: z.number().int(),
  season: z.number().int().min(1),
  episode: z.number().int().min(1),
  note: z.string().optional(),
});

export const override = new Hono()
  .get('/', async (c) => {
    const seriesId = c.req.query('seriesId');
    const list = await prisma.episodeOverride.findMany({
      where: seriesId ? { seriesId } : undefined,
      orderBy: { absoluteNumber: 'asc' },
    });
    return c.json(list);
  })
  .post('/', zValidator('json', createSchema), async (c) => {
    const input = c.req.valid('json');
    const created = await prisma.episodeOverride.upsert({
      where: {
        seriesId_absoluteNumber: { seriesId: input.seriesId, absoluteNumber: input.absoluteNumber },
      },
      create: { ...input, source: 'manual' },
      update: { season: input.season, episode: input.episode, note: input.note },
    });
    return c.json(created, 201);
  })
  .delete('/:id', async (c) => {
    await prisma.episodeOverride.delete({ where: { id: c.req.param('id') } });
    return c.json({ ok: true });
  });
