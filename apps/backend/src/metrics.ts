import { getStatus } from './downloader/qbittorrent';
import { prisma } from './lib/prisma';
import { queueDepths } from './scheduler/queues';

/**
 * 仪表盘 metrics 聚合。
 * 队列深度 / 抓取成功率 / qB 状态 / 磁盘剩余(qB server_state.free_space)。
 */
export async function getMetrics() {
  const [downloads, pendingScrape, completedMedia, qbStatus] = await Promise.all([
    prisma.downloadTask.groupBy({ by: ['status'], _count: true }),
    prisma.mediaFile.count({ where: { scrapeState: { in: ['PENDING', 'MATCHED'] } } }),
    prisma.mediaFile.count({ where: { scrapeState: 'RENAMED' } }),
    getStatus(),
  ]);

  const jobs = await prisma.jobRun.groupBy({ by: ['status'], _count: true });
  type JobGroup = { status: string; _count: number };
  const totalJobs = jobs.reduce((a: number, j: JobGroup) => a + j._count, 0) || 1;
  const successJobs = jobs
    .filter((j: JobGroup) => j.status === 'success')
    .reduce((a: number, j: JobGroup) => a + j._count, 0);

  const downloadsByStatus: Record<string, number> = {};
  for (const d of downloads) downloadsByStatus[d.status] = d._count;

  // qB 的 free_space 是其保存路径(下载盘)的剩余空间, 媒体库同盘(/ssd)共享
  const freeBytes = qbStatus.freeSpaceBytes?.toString() ?? null;

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
      freeSpaceBytes: freeBytes,
    },
    disk: {
      freeBytes,
    },
  };
}
