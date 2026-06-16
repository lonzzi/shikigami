/**
 * dmhy (動漫花園) 抓取适配器。
 *
 * 实测 dmhy 现状 (2026):
 *  - 全站/关键词 RSS: GET /topics/rss/rss.xml?keyword={kw}  ← 真正的 RSS XML
 *  - sort_id 分类 RSS (/topics/list/sort_id/X/rss.xml) → 返回 HTML, 不支持 RSS
 *  - team_id RSS: 不稳定, 实测也常返回 HTML
 *  - 结论: fetchLatest 抓全站 RSS; fetchByKeyword 用关键词; 字幕组靠 title 内 [字幕组名] 匹配
 *
 *  - enclosure.@_url = magnet (base32 btih)
 *  - 字幕组名在 title 第一个 [方括号] 内, 不在 <author>（author 是上传者用户名）
 *  - siteLimiters.dmhy 限流（单站并发=1）+ withCircuit 熔断; 403 → circuit
 */

import { withCircuit } from '../lib/circuit';
import { httpGet } from '../lib/http';
import { siteLimiters } from '../lib/ratelimit';
import { createRssParser, extractItems, parsePubDate, UA } from './normalize';
import type { SiteAdapter, Torrent } from './types';
import { detectSubtitleLang, parseInfoHash } from './types';

const BASE = 'https://share.dmhy.org';

const parser = createRssParser();

export const dmhyAdapter: SiteAdapter = {
  source: 'dmhy',

  /** 抓最新全站 RSS（category 参数保留兼容, 但 dmhy 分类不支持 RSS, 统一抓全站）。 */
  async fetchLatest(_category?: string): Promise<Torrent[]> {
    return poll(`${BASE}/topics/rss/rss.xml`);
  },

  /** 按关键词抓（中文/日文/英文都行, encodeURIComponent）。 */
  async fetchByKeyword(keyword: string): Promise<Torrent[]> {
    return poll(`${BASE}/topics/rss/rss.xml?keyword=${encodeURIComponent(keyword)}`);
  },

  /** 按 team_id 抓（best-effort, 路径不稳定, 失败返回空）。 */
  async fetchByTeam(teamId: string): Promise<Torrent[]> {
    try {
      return await poll(`${BASE}/topics/list/team_id/${teamId}/rss`);
    } catch {
      return [];
    }
  },
};

/** dmhy RSS 轮询: 单站并发=1 + 熔断。403 → circuit。 */
async function poll(url: string): Promise<Torrent[]> {
  return siteLimiters.dmhy(async () =>
    withCircuit('dmhy', async () => {
      const xml = await httpGet(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' },
        retries: 3,
        backoff: 'exp',
        onStatus: (s) => (s === 403 ? 'circuit' : s >= 500 ? 'retry' : 'fail'),
      });
      const doc = parser.parse(xml);
      const items = extractItems(doc);
      return items.map(normalize).filter((t): t is Torrent => !!t && !!t.infoHash && !!t.magnet);
    }),
  );
}

/** dmhy RSS item → Torrent。字幕组从 title 第一个 [方括号] 提取。 */
function normalize(item: Record<string, unknown>): Torrent | null {
  const enclosure = item.enclosure as { '@_url'?: string; '@_length'?: string } | undefined;
  const magnet: string | undefined = enclosure?.['@_url'];
  if (!magnet) return null;
  const infoHash = parseInfoHash(magnet);
  const title: string = (item.title as string) ?? '';
  const link = item.link as string | undefined;
  return {
    source: 'dmhy',
    sourceItemId: extractTopicId(link),
    title,
    magnet,
    infoHash,
    size: parseLength(enclosure?.['@_length']),
    pubDate: parsePubDate(item.pubDate),
    fansub: extractFansub(title),
    subtitleLang: detectSubtitleLang(title),
    category: (item.category as string) || undefined,
    rawItem: item,
  };
}

/**
 * 从 title 第一个 [方括号] 提取字幕组名。
 * dmhy 约定: [字幕组] 标题 ... ; 但要排除纯分辨率/语言方括号 (如 [1080p] [GB])。
 */
function extractFansub(title: string): string | undefined {
  const m = title.match(/^\[([^\]]+)\]/);
  if (!m?.[1]) return undefined;
  const first = m[1].trim();
  // 排除明显不是字幕组的: 纯分辨率/语言/数字
  if (/^\d{3,4}p$/i.test(first)) return undefined;
  if (/^(GB|BIG5|CHS|CHT|DUAL|繁体|简体|简中|繁中|双字|双语)$/i.test(first)) return undefined;
  if (/^\d+$/.test(first)) return undefined;
  return first;
}

/** 从 dmhy 详情页 URL 提取 topic id。 */
function extractTopicId(link: string | undefined): string {
  if (!link) return '';
  const m = link.match(/topics\/view\/(\d+)/) ?? link.match(/(\d+)/);
  return m?.[1] ?? '';
}

function parseLength(len: unknown): bigint | undefined {
  if (len == null) return undefined;
  const n = typeof len === 'number' ? len : Number(String(len).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return BigInt(Math.floor(n));
}
