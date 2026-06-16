import { importDownloadTask } from '../../downloader/import';
import { prisma } from '../../lib/prisma';
import { jobLogger } from '../../logger';

/**
 * 导入作业: DownloadTask.COMPLETED → 枚举文件 → 落 MediaFile(PENDING)。
 * 完成后为每个 video MediaFile 投入 AI 刮削队列。
 */
export async function runImportTask(downloadTaskId: string): Promise<void> {
  const log = jobLogger('import', downloadTaskId);
  const result = await importDownloadTask(downloadTaskId);
  log.info(
    { enumerated: result.enumerated, created: result.created, skipped: result.skipped },
    'import done',
  );

  // 新建的 video MediaFile 投入刮削队列
  const videos = await prisma.mediaFile.findMany({
    where: { downloadTaskId, kind: 'video', scrapeState: 'PENDING' },
  });
  const { enqueueScrape } = await import('../queues');
  for (const v of videos) enqueueScrape(v.id);
}
