import { PrismaClient } from '../../generated/prisma/client';
import { logger } from '../logger';

/**
 * Prisma 单例。SQLite 默认 WAL，长连接复用。
 */
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

if (!globalForPrisma.__prisma) {
  globalForPrisma.__prisma = prisma;
  prisma.$on('warn' as never, (e: { message: string }) => logger.warn({ prisma: e.message }));
  prisma.$on('error' as never, (e: { message: string }) => logger.error({ prisma: e.message }));
}
