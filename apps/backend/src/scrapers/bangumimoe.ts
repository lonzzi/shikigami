/**
 * bangumi.moe 抓取适配器。
 *
 * 架构 5.1 差异表:
 *  - URL: https://bangumi.moe/rss/latest / /rss/{tag_id}
 *  - magnet 来源: **无** —— 仅 .torrent URL，需 webtorrent 解析 .torrent 提 infoHash
 *  - tag_id 先抓 /api/v2/common/search-team?name= 拿（不走 JSON API 拿 RSS 端点，路径不稳）
 *
 * RSS item 结构（去除命名空间前缀后）:
 *   <item>
 *     <title>...</title>
 *     <link>https://bangumi.moe/download/torrent/{hash}/{filename}.torrent</link>
 *     <guid>...</guid>
 *     <pubDate>...</pubDate>
 *     <enclosure url="...torrent" length="..." type="application/x-bittorrent"/>
 *     <category>tag name</category>
 *   </item>
 *
 * 限制:
 *  - bangumi.moe 无 magnet、RSS 不暴露 infoHash，故 normalize 后 infoHash=undefined, magnet=undefined,
 *    仅保留 torrentFileUrl。由种子解析层（webtorrent）后补 infoHash。
 *  - 这点与 mikan 一致，订阅引擎/去重层必须容忍"半成品"。
 *
 * 限流 + 熔断同 dmhy（单站并发=1, 403 触发熔断）。
 */

import { withCircuit } from '../lib/circuit';
import { httpGet } from '../lib/http';
import { siteLimiters } from '../lib/ratelimit';
import {
  createRssParser,
  extractItems,
  makeTorrent,
  parsePubDate,
  parseSizeText,
  UA,
} from './normalize';
import type { SiteAdapter, Torrent } from './types';
import { detectSubtitleLang } from './types';

const BASE = 'https://bangumi.moe';

const parser = createRssParser();

/** bangumimoe 站点适配器。 */
export const bangumimoeAdapter: SiteAdapter = {
  source: 'bangumimoe',

  /**
   * 抓最新。category 在 bangumi.moe 语义为 tag_id。
   * 不传 category 时抓 /rss/latest。
   */
  async fetchLatest(category?: string): Promise<Torrent[]> {
    if (category?.trim()) {
      return poll(`${BASE}/rss/${encodeURIComponent(category)}`);
    }
    return poll(`${BASE}/rss/latest`);
  },

  /**
   * 按关键词抓。bangumi.moe RSS 不支持自由关键词查询；
   * 退化: 抓 latest 全站，内存过滤标题。
   */
  async fetchByKeyword(keyword: string): Promise<Torrent[]> {
    const all = await poll(`${BASE}/rss/latest`);
    const kw = keyword.toLowerCase();
    return all.filter((t) => t.title.toLowerCase().includes(kw));
  },

  /**
   * 按字幕组 team_id（即 tag_id）抓。
   * 路径: {BASE}/rss/{teamId}
   */
  async fetchByTeam(teamId: string): Promise<Torrent[]> {
    return poll(`${BASE}/rss/${encodeURIComponent(teamId)}`);
  },
};

/**
 * 按标签 tag_id 抓（语义同 fetchByTeam，tag_id=字幕组 id）。
 * 注意: 这是 bangumi.moe 专用扩展方法，不在 SiteAdapter 接口里，故作为独立导出函数。
 */
export async function fetchByTag(tagId: string): Promise<Torrent[]> {
  return poll(`${BASE}/rss/${encodeURIComponent(tagId)}`);
}

/**
 * bangumi.moe RSS 轮询。单站并发=1 + 熔断。
 */
async function poll(url: string): Promise<Torrent[]> {
  return siteLimiters.bangumimoe(async () =>
    withCircuit('bangumimoe', async () => {
      const xml = await httpGet(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' },
        retries: 3,
        backoff: 'exp',
        onStatus: (s) => (s === 403 ? 'circuit' : s >= 500 ? 'retry' : 'fail'),
      });
      const doc = parser.parse(xml);
      const items = extractItems(doc);
      // bangumi.moe 无 magnet/infoHash，保留 torrentFileUrl。
      return items
        .map(normalize)
        .filter((t): t is Torrent => !!t && (!!t.torrentFileUrl || !!t.title));
    }),
  );
}

/**
 * bangumi.moe RSS item → Torrent。
 * enclosure.@_url 或 link 是 .torrent 文件 URL，无 magnet。
 * infoHash RSS 不暴露，留 undefined（由种子解析层补）。
 */
function normalize(item: Record<string, unknown>): Torrent | null {
  const enclosure = item.enclosure as { '@_url'?: string; '@_length'?: string } | undefined;
  const link = item.link as string | undefined;
  const torrentFileUrl: string | undefined = enclosure?.['@_url'] ?? link;
  const title: string = (item.title as string) ?? '';
  return makeTorrent({
    source: 'bangumimoe',
    sourceItemId: extractBgmId(link, item),
    title,
    torrentFileUrl,
    infoHash: undefined,
    magnet: undefined,
    size: parseSizeText(enclosure?.['@_length']) ?? extractContentLength(item),
    pubDate: parsePubDate(item.pubDate),
    fansub: undefined, // 由订阅引擎从标题 release_group 解析
    subtitleLang: detectSubtitleLang(title),
    category: (item.category as string) || undefined,
    rawItem: item,
  });
}

/** 从 bangumi.moe link/guid 提取条目 hash id。 */
function extractBgmId(link: string | undefined, item: Record<string, unknown>): string {
  const src = link ?? (item.guid as string) ?? '';
  // /download/torrent/{hash}/{filename}.torrent
  const m = src.match(/torrent\/([0-9a-fA-F]+)/) ?? src.match(/([0-9a-fA-F]{16,})/);
  return m?.[1] ?? '';
}

/** bangumi.moe 部分频道用 torrent:contentLength 给字节。 */
function extractContentLength(item: Record<string, unknown>): bigint | undefined {
  const v =
    (item.contentLength as string | number) ?? (item['torrent:contentLength'] as string | number);
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return BigInt(Math.floor(n));
}
