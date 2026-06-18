import { env } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { listTorrentsDirect, removeTorrentDirect } from '../../lib/qb-direct';
import { jobLogger } from '../../logger';
import { notify } from '../../notify/notifier';

/**
 * qBittorrent 完成轮询作业（架构 5.4）。
 *
 * 设计（修订）:
 *  - 不带 filter，全量 listTorrentsDirect() 分类:
 *      completed → DownloadTask.COMPLETED + 投 importQueue
 *      error/missingFiles → ERROR + 告警
 *      stalledDL 持续 > stalledTimeoutHours → ABANDONED + 清 MagnetSeen(允许换源)
 *  - 做种不打断: abandon 只 removeTorrent(hash, false)。
 *
 * 数据源: lib/qb-direct.ts（SID-direct 登录），不用 @ctrl/qbittorrent——
 * 后者在 qB v5 上 login 超时（CLAUDE.md 已知约束），曾导致 poll 永远拿不到种子、
 * DownloadTask 永不进 COMPLETED、MediaFile 永不创建。
 */
const STALLED_THRESHOLD_MS = env.QBT_STALLED_TIMEOUT_HOURS * 60 * 60 * 1000;

export async function pollQbittorrent(): Promise<void> {
  const log = jobLogger('qb-poll');
  const torrents = await listTorrentsDirect();
  for (const t of torrents) {
    // DB 存 lowercase hex（addMagnet/rss-sync 写入时未大写）；qB 返回大写。统一小写匹配。
    const infoHash = (t.hash ?? '').toLowerCase();
    if (!infoHash) continue;
    const task = await prisma.downloadTask.findUnique({ where: { infoHash } });
    if (!task) continue;

    if (isCompleted(t)) {
      await prisma.downloadTask.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          qbStateRaw: t.state,
          progress: 1,
          savePath: t.savePath ?? task.savePath,
        },
      });
      // 触发导入（通过 importJob）
      const { enqueueImport } = await import('../queues');
      enqueueImport(task.id);
    } else if (t.state === 'error' || t.state === 'missingFiles') {
      await prisma.downloadTask.update({
        where: { id: task.id },
        data: { status: 'ERROR', qbStateRaw: t.state },
      });
      await notify({ text: `任务失败: ${task.rawTitle} (${t.state})` }).catch(() => {});
    } else if (t.state === 'stalledDL') {
      const since = task.stalledSince ?? new Date();
      if (!task.stalledSince) {
        await prisma.downloadTask.update({
          where: { id: task.id },
          data: { stalledSince: since, qbStateRaw: t.state },
        });
      } else if (Date.now() - since.getTime() > STALLED_THRESHOLD_MS) {
        await abandonTask(task.id, infoHash);
      }
    } else {
      // 正常下载中/校验中，更新进度
      await prisma.downloadTask.update({
        where: { id: task.id },
        data: { status: 'DOWNLOADING', qbStateRaw: t.state, progress: t.progress ?? 0 },
      });
    }
  }
  log.debug({ count: torrents.length }, 'qb-poll done');
}

function isCompleted(t: { state: string | null; progress?: number }): boolean {
  const state = t.state ?? '';
  return (
    ['uploading', 'pausedUP', 'stoppedUP', 'stalledUP', 'checkingUP', 'queuedUP'].includes(state) ||
    t.progress === 1
  );
}

async function abandonTask(taskId: string, infoHash: string): Promise<void> {
  await removeTorrentDirect(infoHash, false); // 不删数据
  await prisma.downloadTask.update({ where: { id: taskId }, data: { status: 'ABANDONED' } });
  await prisma.magnetSeen.updateMany({ where: { infoHash }, data: { invalidated: true } });
  jobLogger('qb-poll').warn({ infoHash }, 'task abandoned (stalled too long)');
}
