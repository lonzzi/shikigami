import { getStatus } from './downloader/qbittorrent';
import { env } from './lib/env';
import { prisma } from './lib/prisma';
import { diskUsage } from './lib/statvfs';
import { queueDepths } from './scheduler/queues';

/**
 * 仪表盘 metrics 聚合。
 * 队列深度 / 抓取成功率 / qB 状态 / 磁盘占用。
 */
export async function getMetrics() {
  const [downloads, pendingScrape, completedMedia, qbStatus, dl, lib] = await Promise.all([
    prisma.downloadTask.groupBy({ by: ['status'], _count: true }),
    prisma.mediaFile.count({ where: { scrapeState: { in: ['PENDING', 'MATCHED'] } } }),
    prisma.mediaFile.count({ where: { scrapeState: 'RENAMED' } }),
    getStatus(),
    diskUsage(env.DOWNLOADS_ROOT),
    diskUsage(env.LIBRARY_ROOT),
  ]);

  const jobs = await prisma.jobRun.groupBy({ by: ['status'], _count: true });
  type JobGroup = { status: string; _count: number };
  const totalJobs = jobs.reduce((a: number, j: JobGroup) => a + j._count, 0) || 1;
  const successJobs = jobs
    .filter((j: JobGroup) => j.status === 'success')
    .reduce((a: number, j: JobGroup) => a + j._count, 0);

  const downloadsByStatus: Record<string, number> = {};
  for (const d of downloads) downloadsByStatus[d.status] = d._count;

  return {
    queue: queueDepths(),
    pendingScrape,
    completedMedia,
    downloadsByStatus,
    jobs: {
      successRatio: successJobs / totalJobs,
      byStatus: Object.fromEntries(
        jobs.map((j: { status: string; _count: number }) => [j.status, j._count]),
      ),
    },
    qbittorrent: {
      connected: qbStatus.connected,
      appVersion: qbStatus.appVersion,
      torrentsCount: qbStatus.torrentsCount,
      freeSpaceBytes: qbStatus.freeSpaceBytes?.toString() ?? null,
    },
    disk: {
      downloads: dl
        ? {
            usedRatio: dl.usedRatio,
            freeBytes: dl.freeBytes.toString(),
            totalBytes: dl.totalBytes.toString(),
          }
        : null,
      library: lib
        ? {
            usedRatio: lib.usedRatio,
            freeBytes: lib.freeBytes.toString(),
            totalBytes: lib.totalBytes.toString(),
          }
        : null,
    },
  };
}
