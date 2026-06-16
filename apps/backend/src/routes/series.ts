import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { getCalendar, getSubject, searchSubjects } from '../metadata/bangumi';

/**
 * 作品(Series)路由。
 */
export const series = new Hono()
  .get('/', async (c) => {
    const list = await prisma.series.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { episodes: true, subscriptions: true, mediaFiles: true } } },
    });
    return c.json(list);
  })
  .get('/calendar', async (c) => {
    try {
      const cal = await getCalendar();
      return c.json(cal);
    } catch (e) {
      return c.json({ error: 'calendar_unavailable', message: (e as Error).message }, 502);
    }
  })
  .get('/:id', async (c) => {
    const s = await prisma.series.findUnique({
      where: { id: c.req.param('id') },
      include: { episodes: { orderBy: { absoluteNumber: 'asc' } } },
    });
    if (!s) return c.json({ error: 'not_found' }, 404);
    return c.json(s);
  })
  .post('/search', zValidator('json', z.object({ keyword: z.string().min(1) })), async (c) => {
    const { keyword } = c.req.valid('json');
    const candidates = await searchSubjects(keyword);
    // 落库候选（仅创建缺失的）
    const created = [];
    for (const cand of candidates) {
      const s = await prisma.series.upsert({
        where: { bangumiId: cand.id },
        create: {
          bangumiId: cand.id,
          titleJp: cand.name,
          titleCn: cand.name_cn || null,
        },
        update: {},
      });
      created.push(s);
    }
    return c.json(created);
  });

/** 根据 bangumiId 拉详情并补全 Series（内部辅助）。 */
export async function enrichSeries(seriesId: string): Promise<void> {
  const s = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!s?.bangumiId) return;
  try {
    const subj = await getSubject(s.bangumiId);
    await prisma.series.update({
      where: { id: seriesId },
      data: {
        titleJp: subj.name,
        titleCn: subj.nameCn || s.titleCn,
        ...(subj.date ? { year: Number(subj.date.slice(0, 4)) } : {}),
        posterUrl: subj.poster ?? s.posterUrl,
        metadataRaw: JSON.stringify(subj),
      },
    });
  } catch {
    /* enrichment 失败容忍 */
  }
}

void getSubject;
