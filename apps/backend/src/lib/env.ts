import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * 环境变量集中校验。启动即 fail-fast，避免运行期才发现配置缺失。
 * 含 cron 表达式格式校验（架构评审 M11）。
 */

const cronRegex = z
  .string()
  .regex(
    /^(\*|\d+|\d+-\d+|\*\/\d+)(\/\d+)?(\s+(\*|\d+|\d+-\d+|\*\/\d+)(\/\d+)?){4,5}$/,
    'invalid cron expression (expected 5-6 fields)',
  );

const envSchema = z.object({
  // 运行时
  TZ: z.string().default('Asia/Shanghai'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // 鉴权
  JWT_SECRET: z.string().min(16, 'JWT_SECRET too short (need >=16 chars)'),
  ENCRYPTION_KEY: z.string().min(16, 'ENCRYPTION_KEY too short (need >=16 chars)'),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(1),

  // AI
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  LLM_DAILY_BUDGET_USD: z.coerce.number().min(0).default(1.0),

  // qBittorrent
  QBT_BASE_URL: z.string().url(),
  QBT_USERNAME: z.string().default('admin'),
  QBT_PASSWORD: z.string().default('adminadmin'),
  QBT_API_KEY: z.string().default(''),
  QBT_CATEGORY_DEFAULT: z.string().default('动漫'),
  QBT_SAVEPATH_ROOT: z.string().default('/downloads'),
  QBT_STALLED_TIMEOUT_HOURS: z.coerce.number().int().positive().default(24),

  // 媒体服务器
  MEDIA_SERVER_TYPE: z.enum(['jellyfin', 'emby', 'none']).default('jellyfin'),
  JELLYFIN_BASE_URL: z.string().url().optional(),
  JELLYFIN_API_KEY: z.string().default(''),
  EMBY_BASE_URL: z.string().url().optional(),
  EMBY_API_KEY: z.string().default(''),

  // 元数据
  BANGUMI_ACCESS_TOKEN: z.string().default(''),
  BANGUMI_USER_AGENT: z.string().default('lonzzi/shikigami (https://github.com/lonzzi/shikigami)'),
  TMDB_API_KEY: z.string().default(''),
  TMDB_LANGUAGE: z.string().default('zh-CN'),

  // 路径
  LIBRARY_ROOT: z.string().default('/media/library'),
  DOWNLOADS_ROOT: z.string().default('/downloads'),

  // 调度
  RSS_SYNC_INTERVAL: cronRegex.default('*/15 * * * *'),
  QB_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

  // 通知
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  WECHAT_WORK_WEBHOOK_KEY: z.string().default(''),

  // 代理
  HTTPS_PROXY: z.string().default(''),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export type Env = z.infer<typeof envSchema>;
export const env = loadEnv();

/**
 * 校验 cron 表达式（供运行时动态规则复用）。
 */
export function validateCron(expr: string): boolean {
  return cronRegex.safeParse(expr).success;
}

/**
 * 从 ENCRYPTION_KEY 派生 32 字节 AES 密钥（独立于 JWT_SECRET，架构评审 C/I 项）。
 */
export function deriveEncryptionKey(): Buffer {
  return createHash('sha256').update(env.ENCRYPTION_KEY).digest();
}
