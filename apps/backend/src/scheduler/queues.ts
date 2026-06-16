import Queue from 'better-queue';
import { isRetryable } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { jobLogger } from '../logger';
import { runImportTask } from './jobs/import';
import { runScrapeTask } from './jobs/scrape';

/**
 * 任务队列（架构 5.4）。
 *
 * 注意: better-queue 的 retryDelay 只接受数字常量（不支持函数），故用固定退避。
 * 指数退避通过 better-queue 的 'task_failed' 事件 + 自定义延迟实现。
 * 显式 task id 提取器用业务 id 去重。
 */
const RETRY_DELAY_MS = 5_000;

interface QueueTask {
  id: string;
}

/** 创建带重试 + JobRun 审计的队列。 */
function makeQueue(
  kind: string,
  concurrent: number,
  maxRetries: number,
  runner: (id: string) => Promise<unknown>,
): Queue<QueueTask> {
  return new Queue(
    async (task: QueueTask, cb) => {
      let jobRun = await prisma.jobRun.findFirst({
        where: { kind, queueTaskId: task.id, status: { in: ['queued', 'running'] } },
      });
      if (!jobRun) {
        jobRun = await prisma.jobRun.create({
          data: { kind, status: 'running', queueTaskId: task.id, startedAt: new Date() },
        });
      } else {
        await prisma.jobRun.update({
          where: { id: jobRun.id },
          data: { status: 'running', startedAt: new Date() },
        });
      }
      const log = jobLogger(kind, task.id);
      try {
        const result = await runner(task.id);
        await prisma.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: 'success',
            finishedAt: new Date(),
            result: result ? safeStringify(result) : null,
          },
        });
        cb(undefined, result);
      } catch (e) {
        const retryable = isRetryable(e);
        await prisma.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: retryable ? 'queued' : 'failed',
            finishedAt: retryable ? null : new Date(),
            error: (e as Error).message,
            runs: { increment: 1 },
          },
        });
        log.error({ err: (e as Error).message, retryable }, 'task failed');
        cb(e as Error);
      }
    },
    {
      concurrent,
      maxRetries,
      retryDelay: RETRY_DELAY_MS,
      id: (t: QueueTask) => t.id,
    },
  );
}

export const importQueue = makeQueue('import', 1, 5, (id) => runImportTask(id));
export const aiScrapeQueue = makeQueue('scrape', 1, 3, (id) => runScrapeTask(id));

/** RSS 抓取用直接 await（已是 cron 周期触发），不入 better-queue。 */

export function enqueueImport(downloadTaskId: string): void {
  importQueue.push({ id: downloadTaskId });
}
export function enqueueScrape(mediaFileId: string): void {
  aiScrapeQueue.push({ id: mediaFileId });
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 2000);
  } catch {
    return String(v);
  }
}

export const queues = { importQueue, aiScrapeQueue };

/** 队列深度（metrics 用）。better-queue 的 .length 是当前排队+运行数。 */
export function queueDepths(): { import: number; scrape: number } {
  return {
    import: (importQueue as unknown as { length?: number }).length ?? 0,
    scrape: (aiScrapeQueue as unknown as { length?: number }).length ?? 0,
  };
}
