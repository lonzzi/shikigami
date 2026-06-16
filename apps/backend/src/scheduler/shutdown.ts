import type Queue from 'better-queue';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';
import { aiScrapeQueue, importQueue } from './queues';

/**
 * 优雅关闭（架构 5.4 shutdown.ts 修正）。
 *
 * better-queue 的 .on('drain') 返回 EventEmitter 而非 Promise，手动包 Promise。
 * 步骤: pause → 等 in-flight(≤30s) → running JobRun 回滚 queued → WAL checkpoint → 关 DB → 关 HTTP。
 */

function waitForDrain(q: Queue<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    q.on('drain', done);
    // 兜底: 若队列本身空闲,drain 可能不再触发;1s 内未完成则直接 resolve
    setTimeout(done, 1000);
  });
}

export async function gracefulShutdown(server: ReturnType<typeof Bun.serve> | null): Promise<void> {
  logger.info('graceful shutdown starting');
  try {
    importQueue.pause();
    aiScrapeQueue.pause();

    await Promise.race([
      Promise.all([waitForDrain(importQueue), waitForDrain(aiScrapeQueue)]),
      new Promise((r) => setTimeout(r, 30_000)),
    ]);

    // running JobRun 回滚为 queued（保留 checkpoint，下次启动续跑）
    await prisma.jobRun.updateMany({
      where: { status: 'running' },
      data: { status: 'queued' },
    });

    // wal_checkpoint 返回结果行, 必须用 queryRaw（executeRaw 禁止返回结果）
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await prisma.$disconnect();
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'graceful shutdown error');
  }

  if (server) await server.stop();
  logger.info('graceful shutdown done');
}
