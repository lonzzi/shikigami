import { stat } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';
import { enqueueImport, enqueueScrape } from './queues';

/**
 * 启动 reconcile（架构 5.4 reconcile.ts 修订）。
 *
 * 把崩溃/重启前未完成的任务按 checkpoint 续跑（非从头重跑）:
 *  - import 类 JobRun: 若其 MediaFile 已 RENAMED(libraryPath 存在) → 跳过; 否则重新入队
 *  - scrape 类 JobRun: 重新入队（scrape 内部有 ScrapeCache 幂等）
 *  - COMPLETED 但未 import 的 DownloadTask: 重新入队 import
 */
export async function reconcileStartup(): Promise<void> {
  logger.info('reconcile startup');

  // 1. 未完成的 JobRun（按 queueTaskId 重入对应队列）
  const pendingJobs = await prisma.jobRun.findMany({
    where: { status: { in: ['queued', 'running'] } },
  });
  for (const job of pendingJobs) {
    if (!job.queueTaskId) continue;
    if (job.kind === 'import') {
      // 检查是否已 RENAMED（已硬链接）→ 跳过
      const mf = await prisma.mediaFile.findFirst({
        where: { downloadTaskId: job.queueTaskId, scrapeState: 'RENAMED' },
      });
      if (mf?.libraryPath) {
        try {
          await stat(mf.libraryPath);
          await prisma.jobRun.update({
            where: { id: job.id },
            data: { status: 'success', finishedAt: new Date() },
          });
          continue;
        } catch {
          /* 文件不在，重跑 */
        }
      }
      enqueueImport(job.queueTaskId);
    } else if (job.kind === 'scrape') {
      enqueueScrape(job.queueTaskId);
    }
  }

  // 2. COMPLETED 但还没有 MediaFile 的 DownloadTask → 重新 import
  const orphaned = await prisma.downloadTask.findMany({
    where: { status: 'COMPLETED', mediaFiles: { none: {} } },
    take: 50,
  });
  for (const t of orphaned) enqueueImport(t.id);

  logger.info({ pendingJobs: pendingJobs.length, orphaned: orphaned.length }, 'reconcile done');
}
