import type { FewShotSample } from '../../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';

/**
 * Few-shot 自学习池检索 / 回写（架构 5.2 fewshot.ts）。
 * 人工修正回写后，按 release_group / titleKey LRU 检索注入 prompt。
 */

const MAX_TOTAL = 500; // 池上限
const MAX_PER_GROUP = 3; // 每个 release_group 最多注入的样本数

/**
 * 检索 few-shot 样本，拼成 prompt 中的 "示例:" 段。
 * - 按 release_group 精确匹配 + titleKey 模糊匹配
 * - 取最近使用过的 top-k（MAX_PER_GROUP），命中后更新 lastUsedAt（LRU）
 * - 无样本返回空字符串（scrape.ts 据此决定是否注入 user 消息）
 */
export async function retrieveFewShot(filename: string): Promise<string> {
  const group = extractReleaseGroup(filename);
  const titleKey = normalizeTitle(filename);

  let samples: FewShotSample[];
  try {
    samples = await prisma.fewShotSample.findMany({
      where: {
        reviewStatus: 'approved',
        OR: [{ releaseGroup: group }, { titleKey: { contains: titleKey } }],
      },
      orderBy: { lastUsedAt: 'desc' },
      take: MAX_PER_GROUP,
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'fewshot retrieve failed');
    return '';
  }

  if (samples.length === 0) return '';

  // 更新 lastUsedAt（LRU），失败不阻塞
  prisma.fewShotSample
    .updateMany({
      where: { id: { in: samples.map((s: FewShotSample) => s.id) } },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      /* 非关键路径 */
    });

  const body = samples
    .map((s: FewShotSample) => `输入: ${s.filename}\n输出: ${s.output}`)
    .join('\n');
  return `示例:\n${body}`;
}

/**
 * 保存人工修正样本。
 * - 池超限(MAX_TOTAL)时 FIFO 淘汰最旧一条
 * - reviewStatus 默认 approved（直接生效；冲突校验逻辑由调用方/UI 决定是否 pending）
 */
export async function saveCorrection(
  filename: string,
  output: object,
  seriesId?: string,
): Promise<void> {
  try {
    const total = await prisma.fewShotSample.count();
    if (total >= MAX_TOTAL) {
      // FIFO 淘汰 lastUsedAt 最旧的一条（lastUsedAt 为 null 视为最旧）
      const oldest = await prisma.fewShotSample.findMany({
        orderBy: { lastUsedAt: 'asc' },
        take: 1,
      });
      if (oldest.length > 0 && oldest[0]) {
        await prisma.fewShotSample.deleteMany({ where: { id: oldest[0].id } });
      }
    }

    await prisma.fewShotSample.create({
      data: {
        filename,
        output: JSON.stringify(output),
        releaseGroup: extractReleaseGroup(filename),
        titleKey: normalizeTitle(filename),
        seriesId: seriesId ?? null,
        reviewStatus: 'approved',
      },
    });
  } catch (e) {
    // 写入失败不阻塞人工确认流程
    logger.warn({ err: (e as Error).message }, 'fewshot saveCorrection failed');
  }
}

// ============================================================
// 文件名特征提取（与 release_group/title_hint 检索键对齐）
// ============================================================

/** 提取 release_group: 方括号内第一个非数字 token（字幕组）。 */
function extractReleaseGroup(filename: string): string | null {
  // 去扩展名
  const base = filename.replace(/\.[a-z0-9]{2,4}$/i, '');
  // 找第一个 [xxx] 且内部不是纯数字/纯分辨率
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(base)) !== null) {
    const token = m[1]!.trim();
    if (!token) continue;
    // 跳过纯数字、CRC、分辨率、编码标识
    if (/^\d+$/.test(token)) continue;
    if (/^[0-9A-Fa-f]{8}$/.test(token)) continue; // CRC
    if (/^\d{3,4}[pi]?$/.test(token)) continue; // 分辨率
    if (/^(x264|h264|h265|x265|hevc|avc|10bit|10bits|hi10p)$/i.test(token)) continue;
    if (/^(bdrip|web-dl|webdl|hdtv|dvdrip|remux)$/i.test(token)) continue;
    return token;
  }
  return null;
}

/** 归一化标题用于 titleKey 检索: 去括号/CRC/分辨率/版本号，小写压缩空白。 */
function normalizeTitle(filename: string): string {
  let s = filename.replace(/\.[a-z0-9]{2,4}$/i, '');
  s = s.replace(/\[[0-9A-Fa-f]{8}\]/g, ''); // CRC
  s = s.replace(/\[\d{3,4}[pi]?\]/gi, ''); // 分辨率
  s = s.replace(/v\d+/gi, ''); // 版本号
  s = s
    .replace(/[[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // 截断避免过长 titleKey
  return s.slice(0, 64);
}
