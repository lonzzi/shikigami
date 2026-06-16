import { createHash } from 'node:crypto';
import { prisma } from './prisma';

/**
 * AI 刮削结果缓存助手。
 * 架构评审: 归一化文件名指纹 (去 CRC/分辨率/版本号差异) 后 hash, 避免批量下载同番反复调用。
 */

/** 归一化: 去掉方括号内的 CRC32、分辨率、版本号噪音 → 稳定指纹。 */
export function normalizeFingerprint(filename: string): string {
  let s = filename;
  // 去 CRC32: [ABCD1234]
  s = s.replace(/\[[0-9A-Fa-f]{8}\]/g, '');
  // 去分辨率
  s = s.replace(/\[\d{3,4}p\]/gi, '').replace(/\b\d{3,4}p\b/gi, '');
  // 去版本号 v2/v3
  s = s.replace(/v\d+/gi, '');
  // 去括号空白
  s = s
    .replace(/[[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return createHash('sha256').update(s).digest('hex');
}

export async function getScrapeCache(
  fingerprint: string,
): Promise<{ result: string; model: string } | null> {
  const row = await prisma.scrapeCache.findUnique({ where: { fingerprint } });
  if (!row) return null;
  return { result: row.result, model: row.model };
}

export async function saveScrapeCache(
  fingerprint: string,
  rawFilename: string,
  result: object,
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
): Promise<void> {
  try {
    await prisma.scrapeCache.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        rawFilename,
        result: JSON.stringify(result),
        model,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      },
      update: {
        result: JSON.stringify(result),
        model,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      },
    });
  } catch {
    // 缓存写入失败不应影响主流程
  }
}
