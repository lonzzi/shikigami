/** 抓取层共享契约。所有 SiteAdapter 实现这个接口。 */
export type SiteSource = 'dmhy' | 'mikan' | 'nyaa' | 'bangumimoe';

export interface Torrent {
  source: SiteSource;
  sourceItemId: string;
  title: string;
  magnet?: string;
  torrentFileUrl?: string;
  infoHash?: string;
  size?: bigint;
  pubDate?: Date;
  fansub?: string;
  /** GB/BIG5/CHS/CHT/DUAL — 从标题 [GB][BIG5][双字] 提取 */
  subtitleLang?: string;
  category?: string;
  rawItem: unknown;
}

export interface SiteAdapter {
  readonly source: SiteSource;
  fetchLatest(category?: string): Promise<Torrent[]>;
  fetchByKeyword(keyword: string): Promise<Torrent[]>;
  fetchByTeam?(teamId: string): Promise<Torrent[]>;
}

/** 订阅过滤规则 (filterRule JSON 结构)。 */
export interface FilterRule {
  sources: SiteSource[];
  keyword?: string;
  /** 字幕组 team_id (dmhy/bangumi.moe) */
  teamIds?: string[];
  /** dmhy sort_id: 1=每周单集, 2=季度合集 */
  sortId?: string;
  resolutionMin?: '480p' | '720p' | '1080p' | '2160p';
  /** 字幕组名白名单 (模糊匹配 fansub) */
  fansubs?: string[];
  /** 标题黑名单关键词 */
  blacklist?: string[];
  preferredLang?: 'CHS' | 'CHT' | 'DUAL' | 'ANY';
  /** 分辨率降级链: 首选缺货时依次尝试 */
  fallbackResolution?: string[];
}

/** 从 magnet 中提取 infoHash (btih),base32 自动转 hex(qB v5 不认 base32)。 */
export function parseInfoHash(magnet: string): string | undefined {
  const m = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
  const raw = m?.[1]?.toUpperCase();
  if (!raw) return undefined;
  // base32 (32位 A-Z2-7) → hex (40位); qBittorrent v5 不接受 base32 btih
  return raw.length === 32 ? base32ToHex(raw) : raw;
}

/** base32 → hex(小写)。dmhy magnet 的 btih 是 base32,转 hex 后 qB 才认。 */
export function base32ToHex(b32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of b32.toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 从标题提取语言标识。 */
export function detectSubtitleLang(title: string): string | undefined {
  if (/\[双字\]|双语|DUAL/i.test(title)) return 'DUAL';
  if (/\[GB\]|\[CHS\]|简体|简中/i.test(title)) return 'CHS';
  if (/\[BIG5\]|\[CHT\]|繁体|繁中/i.test(title)) return 'CHT';
  return undefined;
}
