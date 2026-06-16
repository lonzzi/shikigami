/**
 * 抓取层公共工具: 各站 RSS item → Torrent 归一化。
 *
 * 设计: 各站点 RSS 结构差异极大（dmhy/nyaa 用 enclosure，mikan/bangumi.moe 用 link），
 * 但归一化后都收敛到同一份 Torrent。共享逻辑集中在本文件:
 *  - XMLParser 工厂（统一 {ignoreAttributes:false, removeNSPrefix:true, isArray}）
 *  - 通用 UA
 *  - 各站 normalize 函数（站点专用，因为字段路径不同）
 *  - 通用的 size 解析、磁链补全 tr 表
 *
 * 共享契约符号从 ./types 导入: parseInfoHash / detectSubtitleLang。
 * 不要在本文件重新实现这两个函数（架构 5.1 明确要求共享）。
 */

import { XMLParser } from 'fast-xml-parser';
import type { SiteSource, Torrent } from './types';
import { detectSubtitleLang, parseInfoHash } from './types';

/** 站点抓取通用 UA（架构评审: 部分站对 UA 敏感，用主流 Chrome UA）。 */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * 统一 XMLParser。
 * - ignoreAttributes:false: 保留 enclosure.@_url / nyaa:infoHash@_value 等。
 * - removeNSPrefix:true: 去掉 nyaa:torrent:contentLength 这种命名空间前缀。
 * - isArray: 强制 item 为数组（RSS 只有一条时解析器会返回对象，需归一为数组）。
 */
export function createRssParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => name === 'item',
  });
}

/**
 * 从 RSS 文档对象中安全取出 channel.item 数组。
 * 各站 RSS 结构统一为 rss.channel.item[]，但容错解析为空时的 undefined。
 */
export function extractItems(doc: unknown): Record<string, unknown>[] {
  const rss = (doc as { rss?: { channel?: { item?: unknown } } })?.rss;
  const items = rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items)
    ? (items as Record<string, unknown>[])
    : [items as Record<string, unknown>];
}

/** 公共 tracker 列表: mikan/bangumi.moe 等无 magnet 的站点用这些 tr 补全磁链。 */
export const COMMON_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://anidex.moe:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'wss://tracker.openwebtorrent.com',
] as const;

/**
 * 用 infoHash + 公共 tracker 拼一条 magnet。
 * 仅当站点 RSS 不直接给 magnet 但提供了 infoHash（如 nyaa）时调用。
 */
export function buildMagnet(infoHash: string): string {
  const tr = COMMON_TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}${tr}`;
}

/** 解析 enclosure 的字节大小（各站 RSS 可能用 enclosure@_length 或 torrent:contentLength）。 */
export function parseSizeBytes(value: unknown): bigint | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return BigInt(Math.floor(n));
}

/**
 * 把人类可读的体积字符串（"1.2 GB"）转字节。dmhy/bangumi.moe 可能给字符串。
 */
export function parseSizeText(text: unknown): bigint | undefined {
  if (text == null) return undefined;
  if (typeof text === 'number') return parseSizeBytes(text);
  const m = String(text).match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!m || m[1] === undefined || m[2] === undefined) return parseSizeBytes(text);
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return undefined;
  const unit = m[2].toUpperCase();
  const mul: Record<string, number> = { TB: 1e12, GB: 1e9, MB: 1e6, KB: 1e3, B: 1 };
  const factor = mul[unit];
  if (factor === undefined) return undefined;
  return BigInt(Math.floor(num * factor));
}

/** 从 dmhy/mikan 的 link（详情页 URL）里取数字 id 作为 sourceItemId。 */
export function extractNumericId(link: unknown): string {
  if (typeof link !== 'string') return '';
  const m = link.match(/(\d+)/);
  return m?.[1] ?? '';
}

/** 构造一个安全的 normalize 结果（确保必填字段非空）。 */
export function makeTorrent(
  partial: Partial<Torrent> & Pick<Torrent, 'source' | 'sourceItemId' | 'title'>,
): Torrent {
  return {
    magnet: partial.magnet,
    torrentFileUrl: partial.torrentFileUrl,
    infoHash: partial.infoHash,
    size: partial.size,
    pubDate: partial.pubDate,
    fansub: partial.fansub,
    subtitleLang: partial.subtitleLang,
    category: partial.category,
    rawItem: partial.rawItem,
    ...partial,
  } as Torrent;
}

/** pubDate 容错: 字符串/Date/null → Date|undefined。 */
export function parsePubDate(value: unknown): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/** 类型守卫工具: 排除 null/undefined。 */
export function isPresent<T>(x: T | null | undefined): x is T {
  return x != null;
}

export type { SiteSource, Torrent };
// 显式再导出共享符号，便于各 adapter 用统一入口（不修改 types.ts，只是 re-export）。
export { detectSubtitleLang, parseInfoHash };
