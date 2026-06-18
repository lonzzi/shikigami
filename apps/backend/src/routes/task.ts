import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { addMagnet, pauseTorrent, removeTorrent, resumeTorrent } from '../downloader/qbittorrent';
import { prisma } from '../lib/prisma';
import { getTorrentDirect, listTorrentsDirect } from '../lib/qb-direct';
import { enqueueImport } from '../scheduler/queues';
import { parseInfoHash } from '../scrapers/types';

/**
 * 下载任务路由。
 */
const addSchema = z
  .object({
    magnet: z.string().optional(),
    torrentUrl: z.string().url().optional(),
    category: z.string().optional(),
    seriesId: z.string().optional(),
  })
  .refine((v) => v.magnet || v.torrentUrl, { message: 'magnet or torrentUrl required' });

export const task = new Hono()
  .get('/', async (c) => {
    const statusFilter = c.req.query('status');
    const search = c.req.query('search')?.trim().toLowerCase();
    const page = Math.max(1, Number(c.req.query('page') ?? '1'));
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? '30')));

    // 只列 shikigami 自己管理的任务(DB DownloadTask: 订阅抓取 + 手动添加)。
    // qB 里其他软件(nastools/mikan 等)的种子不纳入。
    // 实时进度/state 从 qB 按 hash 补充(若已在 qB 中)。
    const dbTasks = await prisma.downloadTask.findMany({
      orderBy: { addedAt: 'desc' },
      include: { subscription: true },
    });

    // 一次性取 qB 全量, 内存按 hash join 实时数据
    const qbAll = await listTorrentsDirect();
    const qbByHash = new Map(qbAll.map((t) => [t.hash.toLowerCase(), t]));

    let items = dbTasks.map((t) => {
      const qb = t.hash ? qbByHash.get(t.hash.toLowerCase()) : undefined;
      const status = qb ? mapQbState(qb.state) : t.status;
      return {
        id: t.id,
        infoHash: t.infoHash.toUpperCase(),
        rawTitle: t.rawTitle,
        fansub: t.fansub ?? null,
        subtitleLang: t.subtitleLang ?? null,
        sizeBytes: (qb?.size ?? t.sizeBytes)?.toString() ?? '0',
        status,
        qbStateRaw: qb?.state ?? t.qbStateRaw ?? null,
        progress: qb?.progress ?? t.progress,
        dlspeed: qb?.dlspeed ?? 0,
        numSeeds: qb?.numSeeds ?? 0,
        numLeechs: qb?.numLeechs ?? 0,
        seriesId: t.seriesId ?? null,
        subscription: t.subscription ? { id: t.subscription.id, name: t.subscription.name } : null,
        addedAt: t.addedAt ?? null,
      };
    });

    // 状态过滤
    if (statusFilter) items = items.filter((i) => i.status === statusFilter);
    // 关键词搜索（标题/字幕组/订阅名）
    if (search) {
      items = items.filter(
        (i) =>
          i.rawTitle.toLowerCase().includes(search) ||
          (i.fansub?.toLowerCase().includes(search) ?? false) ||
          (i.subscription?.name.toLowerCase().includes(search) ?? false),
      );
    }
    // 状态优先级排序
    items.sort((a, b) => stateOrder(a.status) - stateOrder(b.status));

    const total = items.length;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);
    return c.json({ items: paged, total, page, pageSize, hasMore: start + pageSize < total });
  })
  .post('/', zValidator('json', addSchema), async (c) => {
    const input = c.req.valid('json');
    const magnet = input.magnet ?? input.torrentUrl!;
    const infoHash = input.magnet ? parseInfoHash(input.magnet)?.toUpperCase() : input.torrentUrl;
    if (!infoHash) return c.json({ error: 'cannot_resolve_infohash' }, 400);

    const result = await addMagnet(magnet, { category: input.category });
    const created = await prisma.downloadTask.upsert({
      where: { infoHash },
      create: {
        infoHash,
        source: 'manual',
        magnet: input.magnet,
        torrentUrl: input.torrentUrl,
        // 从 magnet 的 dn 参数取显示名,取不到则用 infoHash
        rawTitle: extractDn(input.magnet) ?? infoHash,
        sizeBytes: 0n,
        status: 'DOWNLOADING',
        hash: infoHash,
        seriesId: input.seriesId,
      },
      update: { status: 'DOWNLOADING' },
    });
    return c.json({ task: created, addResult: result }, 201);
  })
  .get('/:id', async (c) => {
    const t = await prisma.downloadTask.findUnique({
      where: { id: c.req.param('id') },
      include: { mediaFiles: true, subscription: true },
    });
    if (!t) return c.json({ error: 'not_found' }, 404);
    // 合并实时 qB 状态（直查, 不经 30s 轮询缓存）
    const live = t.hash ? await getTorrentDirect(t.hash) : null;
    return c.json({
      ...t,
      live: live
        ? {
            name: live.name,
            state: live.state,
            progress: live.progress,
            dlspeed: live.dlspeed,
            upspeed: live.upspeed,
            numSeeds: live.numSeeds,
            numLeechs: live.numLeechs,
            size: live.size?.toString() ?? null,
          }
        : null,
    });
  })
  // SSE: 实时推送单个任务的 qB 进度（每 2 秒直查 qB）
  .get('/:id/stream', async (c) => {
    const t = await prisma.downloadTask.findUnique({ where: { id: c.req.param('id') } });
    if (!t?.hash) return c.json({ error: 'not_found' }, 404);
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const tick = async () => {
          const live = await getTorrentDirect(t.hash!);
          const payload = live
            ? {
                progress: live.progress,
                state: live.state,
                dlspeed: live.dlspeed,
                numSeeds: live.numSeeds,
                numLeechs: live.numLeechs,
              }
            : { error: 'not_in_qb' };
          controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        await tick();
        const timer = setInterval(tick, 2000);
        // Keep-alive + 清理(客户端断开时 controller.error 触发)
        const ka = setInterval(() => {
          try {
            controller.enqueue(enc.encode(': ping\n\n'));
          } catch {
            clearInterval(timer);
            clearInterval(ka);
          }
        }, 15_000);
        // Hono ReadableStream 无法直接感知客户端断开, 靠 enqueue 失败清理
        (c.env as Record<string, unknown>).__sseCleanup = () => {
          clearInterval(timer);
          clearInterval(ka);
        };
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  })
  .post('/:id/pause', async (c) => {
    const t = await prisma.downloadTask.findUnique({ where: { id: c.req.param('id') } });
    if (!t?.hash) return c.json({ error: 'not_found' }, 404);
    await pauseTorrent(t.hash);
    await prisma.downloadTask.update({ where: { id: t.id }, data: { status: 'PAUSED' } });
    return c.json({ ok: true });
  })
  .post('/:id/resume', async (c) => {
    const t = await prisma.downloadTask.findUnique({ where: { id: c.req.param('id') } });
    if (!t?.hash) return c.json({ error: 'not_found' }, 404);
    await resumeTorrent(t.hash);
    await prisma.downloadTask.update({ where: { id: t.id }, data: { status: 'DOWNLOADING' } });
    return c.json({ ok: true });
  })
  .post('/:id/retry', async (c) => {
    await prisma.downloadTask.update({
      where: { id: c.req.param('id') },
      data: { status: 'RETRY' },
    });
    return c.json({ ok: true });
  })
  .post('/:id/redownload', async (c) => {
    const t = await prisma.downloadTask.findUnique({ where: { id: c.req.param('id') } });
    if (!t) return c.json({ error: 'not_found' }, 404);
    // 清 MagnetSeen 允许换源重下
    await prisma.magnetSeen.updateMany({
      where: { infoHash: t.infoHash },
      data: { invalidated: true },
    });
    await prisma.downloadTask.update({ where: { id: t.id }, data: { status: 'PENDING' } });
    if (t.magnet) await addMagnet(t.magnet);
    return c.json({ ok: true });
  })
  .delete('/:id', async (c) => {
    const t = await prisma.downloadTask.findUnique({ where: { id: c.req.param('id') } });
    if (!t) return c.json({ error: 'not_found' }, 404);
    if (t.hash) await removeTorrent(t.hash, false); // 保留数据
    await prisma.downloadTask.update({ where: { id: t.id }, data: { status: 'REMOVED' } });
    return c.json({ ok: true });
  })
  .post('/:id/import', async (c) => {
    enqueueImport(c.req.param('id'));
    return c.json({ ok: true });
  });

/** 从 magnet 链接的 dn 参数提取显示名（URL 解码）。 */
function extractDn(magnet?: string | null): string | undefined {
  if (!magnet) return undefined;
  const m = magnet.match(/[?&]dn=([^&]+)/);
  if (!m?.[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** qB state → 业务状态语义（供前端展示 + 过滤）。 */
function mapQbState(state: string | null): string {
  if (!state) return 'PENDING';
  if (['uploading', 'pausedUP', 'stoppedUP', 'stalledUP', 'checkingUP', 'queuedUP'].includes(state))
    return 'COMPLETED';
  if (['error', 'missingFiles'].includes(state)) return 'ERROR';
  if (['pausedDL', 'stoppedDL'].includes(state)) return 'PAUSED';
  // downloading / stalledDL / queuedDL / metaDL / forcedDL / allocating / checkingDL
  return 'DOWNLOADING';
}

/** 状态排序优先级（数字越小越靠前）。 */
function stateOrder(status: string): number {
  return { DOWNLOADING: 0, PAUSED: 1, COMPLETED: 2, ERROR: 3, ABANDONED: 4 }[status] ?? 5;
}
