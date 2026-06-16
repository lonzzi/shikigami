import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { saveCorrection } from '../llm/fewshot';
import { AnimeMetaSchema } from '../llm/schema';
import { scrapeFilename } from '../llm/scrape';
import { parse } from '../parser/anitomy';
import { regexChinese } from '../parser/regex-cn';
import { renameAndLink } from '../scheduler/jobs/scrape';
import { enqueueScrape } from '../scheduler/queues';

/**
 * AI 刮削路由。
 */
const previewSchema = z.object({ filename: z.string().min(1) });
// 人工修正的 meta 必须通过 AnimeMetaSchema 校验（拒绝脏数据进 DB/文件名）
const reviewSchema = z.object({ meta: AnimeMetaSchema, force: z.boolean().default(false) });
const batchReviewSchema = z.object({
  releaseGroup: z.string(),
  meta: AnimeMetaSchema,
});

export const scrape = new Hono()
  .get('/pending', async (c) => {
    const files = await prisma.mediaFile.findMany({
      where: { scrapeState: { in: ['FAILED', 'MATCHED'] } },
      include: { downloadTask: true, series: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return c.json(files);
  })
  .post('/preview', zValidator('json', previewSchema), async (c) => {
    const { filename } = c.req.valid('json');
    const pre = parse(filename) ?? regexChinese(filename) ?? undefined;
    const meta = await scrapeFilename(filename, pre);
    return c.json({ meta, preParsed: pre ?? null });
  })
  .post('/:mediaFileId/review', zValidator('json', reviewSchema), async (c) => {
    const mediaFileId = c.req.param('mediaFileId');
    const { meta, force } = c.req.valid('json');
    const mf = await prisma.mediaFile.findUnique({ where: { id: mediaFileId } });
    if (!mf) return c.json({ error: 'not_found' }, 404);

    // 回写 FewShot 自学习池
    await saveCorrection(mf.fileName, meta, mf.seriesId ?? undefined).catch(() => {});

    // 置 REVIEWED（标记已人工确认）；force 决定是否覆盖已有 REVIEWED 态
    if (force || mf.scrapeState !== 'REVIEWED') {
      await prisma.mediaFile.update({
        where: { id: mediaFileId },
        data: { scrapeState: 'REVIEWED', reviewedAt: new Date(), reviewedBy: c.get('user').sub },
      });
    }
    // 人工确认后重命名（meta 已校验为 AnimeMeta；series 由 renameAndLink 内部解析）
    try {
      await renameAndLink(mediaFileId, meta);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: 'rename_failed', message: (e as Error).message }, 500);
    }
  })
  .post('/batch-review', zValidator('json', batchReviewSchema), async (c) => {
    const { releaseGroup, meta } = c.req.valid('json');
    const files = await prisma.mediaFile.findMany({
      where: { kind: 'video', scrapeState: { in: ['FAILED', 'MATCHED', 'PENDING'] } },
    });
    let count = 0;
    for (const f of files) {
      await saveCorrection(f.fileName, meta, f.seriesId ?? undefined).catch(() => {});
      enqueueScrape(f.id);
      count += 1;
    }
    return c.json({ ok: true, queued: count, releaseGroup });
  })
  .post('/:mediaFileId/scrape', async (c) => {
    enqueueScrape(c.req.param('mediaFileId'));
    return c.json({ ok: true });
  });
