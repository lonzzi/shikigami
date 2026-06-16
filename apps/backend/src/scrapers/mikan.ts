/**
 * mikan 抓取适配器。
 *
 * 架构 5.1 差异表:
 *  - URL: https://mikanani.me/RSS/Classic（全站） / /RSS/Bangumi?bangumiId={id}（按番剧）
 *  - magnet 来源: **无** —— enclosure.@_url 是 .torrent 文件 URL
 *  - infoHash: RSS 不暴露，可空。保留 torrentFileUrl，由下载层/种子解析层补 magnet。
 *
 * 与 dmhy/nyaa 的区别: mikan 不给 magnet 也不给 infoHash，所以归一化后
 *   torrent 有 magnet=undefined, infoHash=undefined, torrentFileUrl=非空。
 *   订阅引擎/去重层必须容忍这种"半成品"，由种子解析层（webtorrent）后补 infoHash。
 *
 * 限流 + 熔断同 dmhy（单站并发=1, 403 触发熔断）。
 */

import { withCircuit } from '../lib/circuit';
import { httpGet } from '../lib/http';
import { siteLimiters } from '../lib/ratelimit';
import { createRssParser, extractItems, makeTorrent, parsePubDate, UA } from './normalize';
import type { SiteAdapter, Torrent } from './types';
import { detectSubtitleLang } from './types';

const BASE = 'https://mikanani.me';

const parser = createRssParser();

/** mikan 站点适配器。 */
export const mikanAdapter: SiteAdapter = {
  source: 'mikan',

  /**
   * 抓全站经典 RSS。
   * category 在 mikan 语义不强（分类靠番剧 id），保留参数兼容接口。
   * 路径: {BASE}/RSS/Classic
   */
  async fetchLatest(_category?: string): Promise<Torrent[]> {
    return poll(`${BASE}/RSS/Classic`);
  },

  /**
   * mikan 无关键词 RSS 端点；按关键词改为按番剧 id 抓取语义。
   * 退化为 Classic 全站 + 内存过滤标题包含关键词。
   * 调用方更常用 fetchByBangumiId。
   */
  async fetchByKeyword(keyword: string): Promise<Torrent[]> {
    const all = await poll(`${BASE}/RSS/Classic`);
    const kw = keyword.toLowerCase();
    return all.filter((t) => t.title.toLowerCase().includes(kw));
  },

  /**
   * 按字幕组 team_id 抓取。
   * mikan 的字幕组即番剧发布组，RSS 端点按 bangumiId 抓更准；
   * 这里把 teamId 当 bangumiId 用（订阅规则里 mikan 的 teamIds 存 bangumiId）。
   */
  async fetchByTeam(teamId: string): Promise<Torrent[]> {
    return poll(`${BASE}/RSS/Bangumi?bangumiId=${encodeURIComponent(teamId)}`);
  },
};

/**
 * 按番剧 bangumiId 抓取（mikan 主用入口，对应 dmhy 的 fetchByTeam 语义）。
 * 注意: 这是 mikan 专用扩展方法，不在 SiteAdapter 接口里，故作为独立导出函数。
 */
export async function fetchByBangumiId(bangumiId: string | number): Promise<Torrent[]> {
  return poll(`${BASE}/RSS/Bangumi?bangumiId=${encodeURIComponent(String(bangumiId))}`);
}

/**
 * mikan RSS 轮询。单站并发=1 + 熔断。
 * 注意: mikanani.me 国内可能墙，部署时可配镜像（修改 BASE 或经 HTTPS_PROXY）。
 */
async function poll(url: string): Promise<Torrent[]> {
  return siteLimiters.mikan(async () =>
    withCircuit('mikan', async () => {
      const xml = await httpGet(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' },
        retries: 3,
        backoff: 'exp',
        onStatus: (s) => (s === 403 ? 'circuit' : s >= 500 ? 'retry' : 'fail'),
      });
      const doc = parser.parse(xml);
      const items = extractItems(doc);
      // mikan enclosure 是 .torrent URL（非 magnet），保留 torrentFileUrl。
      // 不像 dmhy 那样过滤 magnet —— mikan 本就没 magnet。
      return items
        .map(normalize)
        .filter((t): t is Torrent => !!t && (!!t.torrentFileUrl || !!t.title));
    }),
  );
}

/**
 * mikan RSS item → Torrent。
 * enclosure.@_url 是 .torrent 文件 URL，无 magnet。
 * infoHash RSS 不暴露，留 undefined（由种子解析层补）。
 */
function normalize(item: Record<string, unknown>): Torrent | null {
  const enclosure = item.enclosure as
    | { '@_url'?: string; '@_length'?: string; '@_type'?: string }
    | undefined;
  const torrentFileUrl: string | undefined = enclosure?.['@_url'];
  const title: string = (item.title as string) ?? '';
  const link = item.link as string | undefined;
  // mikan enclosure type 通常是 application/x-bittorrent
  return makeTorrent({
    source: 'mikan',
    sourceItemId: extractMikanId(link, torrentFileUrl),
    title,
    torrentFileUrl,
    infoHash: undefined,
    magnet: undefined,
    size: parseLength(enclosure?.['@_length']),
    pubDate: parsePubDate(item.pubDate),
    fansub: extractFansub(item),
    subtitleLang: detectSubtitleLang(title),
    category: (item.category as string) || undefined,
    rawItem: item,
  });
}

/** 从 mikan 详情页 URL 或 torrent URL 提取番剧/条目 id。 */
function extractMikanId(link: string | undefined, torrentUrl: string | undefined): string {
  const src = link ?? torrentUrl ?? '';
  // /Home/Episode/{id} 或 /Download/{guid}/{filename}.torrent
  const m = src.match(/Episode\/(\d+)/) ?? src.match(/Download\/([^/]+)/);
  return m?.[1] ?? '';
}

/** mikan 部分频道把字幕组放在 author 或 dc:creator。 */
function extractFansub(item: Record<string, unknown>): string | undefined {
  const author = item.author as { name?: string } | string | undefined;
  if (typeof author === 'string') return author || undefined;
  if (author?.name) return author.name;
  const creator = item['dc:creator'] as string | undefined;
  return creator || undefined;
}

/** 解析 enclosure length 字段为 bigint 字节。 */
function parseLength(len: unknown): bigint | undefined {
  if (len == null) return undefined;
  const n = typeof len === 'number' ? len : Number(String(len).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return BigInt(Math.floor(n));
}
