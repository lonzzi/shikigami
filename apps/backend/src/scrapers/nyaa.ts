/**
 * nyaa 抓取适配器。
 *
 * 架构 5.1 差异表:
 *  - URL: https://nyaa.si/?page=rss&q={q}&c=1_3&f=0 (c=1_3=Non-English)
 *  - magnet 来源: nyaa:infoHash 属性直接拼 magnet + 公共 tr
 *  - 修订: 中文定向**靠关键词+标题语言检测，不依赖分类号**。1_3 含中文字幕组但也含日文/韩文标题。
 *
 * nyaa RSS item 结构:
 *   <item>
 *     <title>...</title>
 *     <link>https://nyaa.si/view/{id}</link>
 *     <guid isPermaLink="true">...</guid>
 *     <pubDate>...</pubDate>
 *     <nyaa:infoHash>{hash}</nyaa:infoHash>          ← removeNSPrefix 后变 infoHash
 *     <nyaa:categoryId>1_3</nyaa:categoryId>          ← categoryId
 *     <nyaa:seeders>123</nyaa:seeders>
 *     <nyaa:leechers>...</nyaa:leechers>
 *     <nyaa:size>1.2 GiB</nyaa:size>
 *     <enclosure url="...torrent" length="..." type="application/x-bittorrent"/>
 *   </item>
 *
 * 限流 + 熔断同 dmhy（单站并发=1, 403 触发熔断）。
 */

import { withCircuit } from '../lib/circuit';
import { httpGet } from '../lib/http';
import { siteLimiters } from '../lib/ratelimit';
import {
  buildMagnet,
  createRssParser,
  extractItems,
  makeTorrent,
  parsePubDate,
  parseSizeText,
  UA,
} from './normalize';
import type { SiteAdapter, Torrent } from './types';
import { detectSubtitleLang } from './types';

const BASE = 'https://nyaa.si';

/** nyaa 分类: 1_3=Non-English（含中文字幕组），1_4=Raw 生肉。架构修订默认 1_3。 */
const DEFAULT_CATEGORY = '1_3';

const parser = createRssParser();

/** nyaa 站点适配器。 */
export const nyaaAdapter: SiteAdapter = {
  source: 'nyaa',

  /**
   * 抓最新。category 默认 1_3（Non-English）。
   * nyaa 的"最新"端点不带 q 会返回全站最新；传 category 进 c 参数。
   * 路径: {BASE}/?page=rss&c={category}&f=0
   */
  async fetchLatest(category: string = DEFAULT_CATEGORY): Promise<Torrent[]> {
    return poll(`${BASE}/?page=rss&c=${encodeURIComponent(category)}&f=0`);
  },

  /**
   * 按关键词抓。
   * 路径: {BASE}/?page=rss&q={keyword}&c=1_3&f=0
   * 按 seeders 倒序（架构 5.1 表格: &s=seeders&o=desc）。
   */
  async fetchByKeyword(keyword: string): Promise<Torrent[]> {
    return poll(
      `${BASE}/?page=rss&q=${encodeURIComponent(keyword)}&c=${DEFAULT_CATEGORY}&f=0&s=seeders&o=desc`,
    );
  },

  // nyaa 无字幕组（team）端点概念；fetchByTeam 留空，调用方应改用 fetchByKeyword
};

/**
 * nyaa RSS 轮询。单站并发=1 + 熔断。
 */
async function poll(url: string): Promise<Torrent[]> {
  return siteLimiters.nyaa(async () =>
    withCircuit('nyaa', async () => {
      const xml = await httpGet(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' },
        retries: 3,
        backoff: 'exp',
        onStatus: (s) => (s === 403 ? 'circuit' : s >= 500 ? 'retry' : 'fail'),
      });
      const doc = parser.parse(xml);
      const items = extractItems(doc);
      // nyaa 给了 infoHash，可拼 magnet; 过滤掉无 infoHash 的
      return items.map(normalize).filter((t): t is Torrent => !!t && !!t.infoHash);
    }),
  );
}

/**
 * nyaa RSS item → Torrent。
 * removeNSPrefix 把 nyaa:infoHash 解析为 infoHash 字段（值为字符串）。
 * 用 infoHash 拼 magnet + 公共 tr。
 */
function normalize(item: Record<string, unknown>): Torrent | null {
  // nyaa:infoHash 去 NS 后变 infoHash
  const infoHashRaw = (item.infoHash as string) ?? (item['nyaa:infoHash'] as string) ?? undefined;
  const infoHash = infoHashRaw ? infoHashRaw.toUpperCase() : undefined;
  if (!infoHash) return null;
  const magnet = buildMagnet(infoHash);
  const title: string = (item.title as string) ?? '';
  const link = item.link as string | undefined;

  const enclosure = item.enclosure as { '@_url'?: string; '@_length'?: string } | undefined;
  // size 优先 nyaa:size 文本，退化 enclosure length
  const size =
    parseSizeText(item.size) ??
    parseSizeText(item['nyaa:size']) ??
    parseLength(enclosure?.['@_length']);

  return makeTorrent({
    source: 'nyaa',
    sourceItemId: extractNyaaId(link, item),
    title,
    magnet,
    infoHash,
    torrentFileUrl: enclosure?.['@_url'],
    size,
    pubDate: parsePubDate(item.pubDate),
    fansub: undefined, // nyaa 无统一字幕组字段，由订阅引擎 anitomy 解析 release_group
    subtitleLang: detectSubtitleLang(title),
    category: ((item.categoryId as string) ?? (item['nyaa:categoryId'] as string)) || undefined,
    rawItem: item,
  });
}

/** 从 nyaa 详情页 URL 或 guid 提取 view id。 */
function extractNyaaId(link: string | undefined, item: Record<string, unknown>): string {
  const src = link ?? (item.guid as string) ?? '';
  const m = src.match(/view\/(\d+)/) ?? src.match(/(\d+)/);
  return m?.[1] ?? '';
}

/** 解析 enclosure length 字段为 bigint 字节。 */
function parseLength(len: unknown): bigint | undefined {
  if (len == null) return undefined;
  const n = typeof len === 'number' ? len : Number(String(len).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return BigInt(Math.floor(n));
}
