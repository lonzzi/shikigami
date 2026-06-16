import pino from 'pino';
import { env } from './lib/env';

/**
 * 结构化日志单例。生产 JSON，开发 pretty。
 * 架构评审 I7: requestId / job kind / 错误码 上下文由调用方 merge。
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: 'shikigami' },
  redact: {
    paths: [
      '*.password',
      '*.apiKey',
      '*.token',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.LLM_API_KEY',
    ],
    censor: '[REDACTED]',
  },
  ...(env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
});

/** 为某个 job/cron 创建带上下文的子 logger。 */
export function jobLogger(kind: string, id?: string) {
  return logger.child({ job: kind, ...(id ? { jobId: id } : {}) });
}
