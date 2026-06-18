import { env } from '../lib/env';
import { httpGet } from '../lib/http';
import { tmdbLimit } from '../lib/ratelimit';
import { logger } from '../logger';

/**
 * TMDB v3 API 封装 (架构 5.3 / 元数据层)。
 *
 * 路由 (对齐 ARCHITECTURE.md 行 2012-2013):
 *   - 搜索剧集: GET /3/search/tv?query={kw}&language=zh-CN
 *   - 剧集详情: GET /3/tv/{id}?language=zh-CN
 *   - 季详情:   GET /3/tv/{id}/season/{n}?language=zh-CN
 *   - 绝对集:   GET /3/tv/{id}/episode_groups   (absolute order)
 *
 * 鉴权: API Key query (api_key=) + Bearer token 二选一; 这里统一用 api_key。
 * 限流: 4 req/s (经 tmdbLimit)。语言 zh-CN (env.TMDB_LANGUAGE)。
 */

const BASE = 'https://api.themoviedb.org/3';

/** TMDB 海报/still 图片 CDN 前缀。 */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** 构造鉴权 query string (api_key 优先, 兼容 v3 auth)。 */
function authQuery(): string {
  if (env.TMDB_API_KEY) return `api_key=${encodeURIComponent(env.TMDB_API_KEY)}`;
  return '';
}

/** TMDB key 是否已配置（仅静态判断，不打网络）。供 status 路由/告警用。 */
export function tmdbConfigured(): boolean {
  return !!env.TMDB_API_KEY && env.TMDB_API_KEY.trim().length > 0;
}

/** GET (经 tmdbLimit=4 并发)。TMDB key 缺失时直接抛，避免无谓请求。 */
async function tmdbGet<T>(path: string): Promise<T> {
  if (!env.TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY not configured');
  }
  return tmdbLimit(async () => {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${BASE}${path}${sep}${authQuery()}&language=${encodeURIComponent(env.TMDB_LANGUAGE)}`;
    const text = await httpGet(url, {
      retries: 2,
      backoff: 'exp',
    });
    return JSON.parse(text) as T;
  });
}

// ============================================================
// 搜索 / 详情
// ============================================================

/** TMDB 搜索结果原始字段 (节选)。 */
interface TmdbRawSearchResult {
  results?: Array<{
    id: number;
    name?: string;
    original_name?: string;
    overview?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
    first_air_date?: string;
    origin_country?: string[];
    vote_average?: number;
  }>;
  total_results?: number;
}

/** 规整后的剧集搜索候选。 */
export interface TmdbTv {
  id: number;
  name: string;
  originalName: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  firstAirDate?: string;
  voteAverage?: number;
}

/**
 * 搜索 TV 剧集 (zh-CN)。
 * @param keyword 标题关键词
 */
export async function searchTv(keyword: string): Promise<TmdbTv[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  try {
    const data = await tmdbGet<TmdbRawSearchResult>(
      `/search/tv?query=${encodeURIComponent(trimmed)}`,
    );
    return (data.results ?? []).slice(0, 5).map((r) => ({
      id: r.id,
      name: r.name ?? '',
      originalName: r.original_name ?? '',
      overview: r.overview ?? '',
      posterPath: r.poster_path ?? undefined,
      backdropPath: r.backdrop_path ?? undefined,
      firstAirDate: r.first_air_date,
      voteAverage: r.vote_average,
    }));
  } catch (e) {
    logger.warn({ err: (e as Error).message, keyword }, 'tmdb search failed');
    return [];
  }
}

/** TMDB 剧集详情原始字段 (节选)。 */
interface TmdbRawTv {
  id: number;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
  seasons?: TmdbRawSeason[];
  external_ids?: { tvdb_id?: number; imdb_id?: string };
  created_by?: Array<{ id: number; name: string }>;
  networks?: Array<{ id: number; name: string }>;
}

/** TMDB 季原始字段 (节选)。 */
interface TmdbRawSeason {
  id: number;
  season_number: number;
  name?: string;
  overview?: string;
  air_date?: string;
  episode_count?: number;
  poster_path?: string | null;
}

/** 规整后的剧集详情。 */
export interface TmdbTvDetail {
  id: number;
  name: string;
  originalName: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  firstAirDate?: string;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  voteAverage?: number;
  seasons: TmdbSeason[];
  tvdbId?: number;
  imdbId?: string;
}

/** 规整后的季。 */
export interface TmdbSeason {
  id: number;
  seasonNumber: number;
  name: string;
  overview: string;
  airDate?: string;
  episodeCount: number;
  posterPath?: string;
}

/** 取剧集详情 (含 seasons + external_ids.tvdb_id, 用于回填 Series.tvdbId)。 */
export async function getTv(id: number): Promise<TmdbTvDetail> {
  const raw = await tmdbGet<TmdbRawTv>(`/tv/${id}`);
  return {
    id: raw.id,
    name: raw.name ?? '',
    originalName: raw.original_name ?? '',
    overview: raw.overview ?? '',
    posterPath: raw.poster_path ?? undefined,
    backdropPath: raw.backdrop_path ?? undefined,
    firstAirDate: raw.first_air_date,
    numberOfSeasons: raw.number_of_seasons ?? 0,
    numberOfEpisodes: raw.number_of_episodes ?? 0,
    voteAverage: raw.vote_average,
    seasons: (raw.seasons ?? []).map((s) => ({
      id: s.id,
      seasonNumber: s.season_number,
      name: s.name ?? '',
      overview: s.overview ?? '',
      airDate: s.air_date,
      episodeCount: s.episode_count ?? 0,
      posterPath: s.poster_path ?? undefined,
    })),
    tvdbId: raw.external_ids?.tvdb_id,
    imdbId: raw.external_ids?.imdb_id,
  };
}

// ============================================================
// 季详情 / 绝对集 (episode_groups)
// ============================================================

/** TMDB 单集原始字段 (节选)。 */
interface TmdbRawEpisode {
  id: number;
  episode_number: number;
  season_number?: number;
  name?: string;
  overview?: string;
  air_date?: string;
  still_path?: string | null;
  runtime?: number;
  vote_average?: number;
}

/** 规整后的单集。 */
export interface TmdbEpisode {
  id: number;
  episodeNumber: number;
  seasonNumber?: number;
  name: string;
  overview: string;
  airDate?: string;
  stillPath?: string;
  runtime?: number;
}

/** 取某季单集列表 (zh-CN)。 */
export async function getSeasonEpisodes(
  tvId: number,
  seasonNumber: number,
): Promise<TmdbEpisode[]> {
  const raw = await tmdbGet<{ episodes?: TmdbRawEpisode[] }>(`/tv/${tvId}/season/${seasonNumber}`);
  return (raw.episodes ?? []).map((e) => ({
    id: e.id,
    episodeNumber: e.episode_number,
    seasonNumber: e.season_number,
    name: e.name ?? '',
    overview: e.overview ?? '',
    airDate: e.air_date,
    stillPath: e.still_path ?? undefined,
    runtime: e.runtime,
  }));
}

/** TMDB episode_groups 原始字段 (节选, absolute order)。 */
interface TmdbRawEpisodeGroup {
  id: number;
  name?: string;
  type?: number; // 1=原创 2=Absolute 3=DVD 4=数字 5=故事 6=制作
  episode_count?: number;
  grouped?: boolean;
}

/** TMDB episode_group 内某组单集。 */
interface TmdbRawGroupEpisode {
  id: number;
  name?: string;
  episode_number?: number; // absolute number (该组内连续)
  order?: number;
  episodes?: Array<{
    id: number;
    season_number?: number;
    episode_number?: number;
    name?: string;
    overview?: string;
    air_date?: string;
    still_path?: string | null;
  }>;
}

/** 规整后的绝对集 group。 */
export interface TmdbEpisodeGroup {
  id: number;
  name: string;
  type: number;
  episodeCount: number;
  /** 该组内单集: absoluteNumber → SxxExx 映射 */
  episodes: Array<{
    absoluteNumber: number;
    seasonNumber?: number;
    episodeNumber?: number;
    name: string;
    airDate?: string;
    stillPath?: string;
  }>;
}

/**
 * 取 episode_groups (absolute order)。
 * 用于把字幕组连续集号 ↔ TMDB SxxExx 对齐 (架构 5.3 seasonOffset 来源之一)。
 * 优先返回 type=2 (Absolute) 的组。
 */
export async function getEpisodeGroups(tvId: number): Promise<TmdbEpisodeGroup[]> {
  const raw = await tmdbGet<{ results?: TmdbRawEpisodeGroup[] }>(`/tv/${tvId}/episode_groups`);
  const groups = (raw.results ?? []).sort((a, b) => {
    // type=2 (Absolute) 优先
    const pa = a.type === 2 ? 0 : 1;
    const pb = b.type === 2 ? 0 : 1;
    return pa - pb;
  });

  const out: TmdbEpisodeGroup[] = [];
  for (const g of groups) {
    try {
      const detail = await tmdbGet<TmdbRawGroupEpisode>(`/tv/episode_group/${g.id}`);
      const eps = (detail.episodes ?? []).map((e, idx) => ({
        absoluteNumber: detail.episode_number ?? detail.order ?? idx + 1,
        seasonNumber: e.season_number,
        episodeNumber: e.episode_number,
        name: e.name ?? '',
        airDate: e.air_date,
        stillPath: e.still_path ?? undefined,
      }));
      out.push({
        id: g.id,
        name: g.name ?? '',
        type: g.type ?? 0,
        episodeCount: g.episode_count ?? eps.length,
        episodes: eps,
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message, groupId: g.id }, 'tmdb episode_group detail failed');
    }
  }
  return out;
}

/** 拼完整图片 URL。size 如 w500/original。 */
export function imageUrl(path?: string, size = 'w500'): string | undefined {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : undefined;
}
