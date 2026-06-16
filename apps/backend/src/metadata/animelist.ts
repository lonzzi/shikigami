import { XMLParser } from 'fast-xml-parser';
import { httpGet } from '../lib/http';
import { logger } from '../logger';

/**
 * anime-lists.xml AniDB→TVDB 映射 (架构 5.3 / I8 修正)。
 *
 * 用途: Bangumi/TMDB 都不直接给 TVDB id, 而 Jellyfin 默认以 TVDB 主键匹配,
 * 因此需要 anime-lists.xml 回填 Series.tvdbId (AnimeLib 维护的 AniDB→TVDB 表)。
 *
 * 来源 (ARCHITECTURE.md 行 2014):
 *   https://raw.githubusercontent.com/AnimeLib/anime-lists/master/anime-list-master.xml
 *
 * 状态: 占位实现 — 函数签名已给全, 内部 best-effort fetch + parse,
 *       失败抛 NotImplementedError。完整映射 (多季/animeid 偏移) 由主线后续补全。
 *
 * XML 结构 (anime-list-master.xml, 典型形态):
 *   <anime-list>
 *     <anime anidbid="123" tvdbid="4567" defaulttvdbseason="1" episodeoffset="0">
 *       <name>Example</name>
 *     </anime>
 *     ...
 *   </anime-list>
 */

/** anime-lists.xml 数据源。 */
const ANIME_LIST_URL =
  'https://raw.githubusercontent.com/AnimeLib/anime-lists/master/anime-list-master.xml';

/** 未实现错误 (占位阶段的核心映射逻辑未补全时抛出)。 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/** 单条 AniDB→TVDB 映射。 */
export interface AnidbTvdbMapping {
  /** AniDB 条目 id (字符串, 因 anidbid 可含非纯数字形态) */
  anidbId: string;
  /** TVDB 条目 id (0 = 无对应) */
  tvdbId: number;
  /** 默认季 (用于多季拆分) */
  defaultTvdbSeason?: number;
  /** 集号偏移 (AniDB ep + offset = TVDB ep) */
  episodeOffset?: number;
  /** 原文名 */
  name?: string;
}

/** 解析后的映射表。 */
export interface AnidbTvdbTable {
  /** anidbId → 映射 */
  byAnidb: Map<string, AnidbTvdbMapping>;
  /** 抓取时间戳 (用于失效判断) */
  fetchedAt: Date;
}

// 进程内缓存 (单次启动内只抓一次; 刷新由调度层 daily job 触发)
let _cache: AnidbTvdbTable | null = null;

/**
 * 从 anime-lists.xml 拉取并解析 AniDB→TVDB 映射表。
 * 单次启动内缓存, 失败抛 NotImplementedError (占位阶段不阻塞主流程)。
 */
export async function loadAnimeList(): Promise<AnidbTvdbTable> {
  if (_cache) return _cache;
  try {
    const xml = await httpGet(ANIME_LIST_URL, {
      retries: 2,
      backoff: 'exp',
      timeoutMs: 60_000,
    });
    _cache = parseAnimeListXml(xml);
    logger.info({ count: _cache.byAnidb.size }, 'anime-lists.xml loaded');
    return _cache;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'anime-lists.xml load failed');
    throw new NotImplementedError(
      `anime-lists.xml fetch/parse not available: ${(e as Error).message}`,
    );
  }
}

/**
 * 解析 anime-list-master.xml → 映射表 (导出供测试直接调用)。
 * 失败抛 NotImplementedError。
 */
export function parseAnimeListXml(xml: string): AnidbTvdbTable {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) => tagName === 'anime',
  });
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw new NotImplementedError(`anime-lists.xml parse failed: ${(e as Error).message}`);
  }

  const root = (doc as { 'anime-list'?: { anime?: RawAnimeEntry[] } })['anime-list'];
  const list = root?.anime ?? [];

  const byAnidb = new Map<string, AnidbTvdbMapping>();
  for (const entry of list) {
    const anidbId = attrStr(entry, '@_anidbid');
    if (!anidbId) continue;
    const tvdbId = attrInt(entry, '@_tvdbid') ?? 0;
    byAnidb.set(anidbId, {
      anidbId,
      tvdbId,
      defaultTvdbSeason: attrInt(entry, '@_defaulttvdbseason'),
      episodeOffset: attrInt(entry, '@_episodeoffset'),
      name: typeof entry.name === 'string' ? entry.name : undefined,
    });
  }

  return { byAnidb, fetchedAt: new Date() };
}

interface RawAnimeEntry {
  '@_anidbid'?: string;
  '@_tvdbid'?: string | number;
  '@_defaulttvdbseason'?: string | number;
  '@_episodeoffset'?: string | number;
  name?: string | unknown;
}

/** 安全读字符串属性。 */
function attrStr(e: RawAnimeEntry, k: string): string | undefined {
  const v = (e as Record<string, unknown>)[k];
  return typeof v === 'string' ? v : v != null ? String(v) : undefined;
}

/** 安全读整数属性。 */
function attrInt(e: RawAnimeEntry, k: string): number | undefined {
  const v = (e as Record<string, unknown>)[k];
  if (v == null) return undefined;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

// ============================================================
// 查询接口 (回填 Series.tvdbId 用)
// ============================================================

/**
 * 取 anidbId 对应的 tvdbId。
 * 无映射 / 无数据源时返回 null (调用方应跳过 tvdbId 回填)。
 *
 * 注: 完整映射应支持多季 (defaulttvdbseason + episodeoffset 拆季)，
 *     占位阶段仅返回顶层 tvdbId, 季级映射由主线后续补全。
 */
export async function getTvdbIdForAnidb(anidbId: string): Promise<number | null> {
  const table = await loadAnimeList().catch(() => null);
  if (!table) return null;
  const m = table.byAnidb.get(anidbId);
  if (!m || m.tvdbId <= 0) return null;
  return m.tvdbId;
}

/** 取完整映射条目 (含 defaulttvdbseason / episodeoffset, 供季级映射)。 */
export async function getMappingForAnidb(anidbId: string): Promise<AnidbTvdbMapping | null> {
  const table = await loadAnimeList().catch(() => null);
  if (!table) return null;
  return table.byAnidb.get(anidbId) ?? null;
}

/**
 * (占位) 季级映射: 给定 anidbId + anidb episode → {season, episode}。
 * 多季拆分规则复杂 (defaulttvdbseason + episodeoffset + tmdbid 偏移)，
 * 占位阶段抛 NotImplementedError, 由主线后续补全。
 */
export async function mapAnidbEpisodeToTvdb(
  anidbId: string,
  anidbEpisode: number,
): Promise<{ tvdbId: number; season: number; episode: number }> {
  void anidbId;
  void anidbEpisode;
  throw new NotImplementedError('mapAnidbEpisodeToTvdb: season-level mapping not yet implemented');
}

/**
 * 清除进程内缓存 (调度层 daily refresh 调用)。
 */
export function invalidateAnimeListCache(): void {
  _cache = null;
}
