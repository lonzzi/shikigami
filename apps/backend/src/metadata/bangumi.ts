import { env } from '../lib/env';
import { httpGet } from '../lib/http';
import { bangumiThrottle } from '../lib/ratelimit';
import { logger } from '../logger';

/**
 * Bangumi v0 API 封装 (架构 5.3 / 元数据层)。
 *
 * 路由 (对齐 ARCHITECTURE.md 行 2008-2011):
 *   - 放送日历: GET  https://api.bgm.tv/calendar
 *   - 搜索:     POST https://api.bgm.tv/v0/search/subjects  body {keyword,sort:'match',filter:{type:[2]}}
 *   - 条目详情: GET  https://api.bgm.tv/v0/subjects/{id}
 *   - 集表:     GET  https://api.bgm.tv/v0/episodes?subject_id={id}&type=0&limit=200&offset=0
 *   - 关系:     GET  https://api.bgm.tv/v0/subjects/{id}/subjects
 *
 * 限流: ≤1 req/s (经 bangumiThrottle)。Header 强制带描述性 User-Agent，
 *       可选 Authorization Bearer token (env.BANGUMI_ACCESS_TOKEN)。
 */

const BASE = 'https://api.bgm.tv';

/** 带描述性 UA + 可选 token 的公共请求头。 */
function bangumiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': env.BANGUMI_USER_AGENT,
    Accept: 'application/json',
    ...(env.BANGUMI_ACCESS_TOKEN ? { Authorization: `Bearer ${env.BANGUMI_ACCESS_TOKEN}` } : {}),
    ...extra,
  };
}

/** GET (经 throttle)，429/5xx 由 httpGet 自动重试。 */
async function bangumiGet(path: string): Promise<unknown> {
  return bangumiThrottle(async () => {
    const text = await httpGet(`${BASE}${path}`, {
      headers: bangumiHeaders(),
      retries: 2,
      backoff: 'exp',
    });
    return JSON.parse(text);
  });
}

/** POST (经 throttle)。 */
async function bangumiPost(path: string, body: unknown): Promise<unknown> {
  return bangumiThrottle(async () => {
    const text = await httpGet(`${BASE}${path}`, {
      method: 'POST',
      headers: bangumiHeaders({ 'Content-Type': 'application/json' }),
      body: typeof body === 'string' ? body : JSON.stringify(body),
      retries: 2,
      backoff: 'exp',
    });
    return JSON.parse(text);
  });
}

// ============================================================
// 搜索 (供 llm/scrape.ts 交叉验证 + series 落库)
// ============================================================

/**
 * 搜索候选最小投影。字段名对齐 Bangumi 原生 (name / name_cn)。
 * 注: 交叉验证时用 candidates[0].name_cn (无中文名则回退 name) 算相似度。
 */
export interface BangumiSearchCandidate {
  id: number;
  /** 原文名 (日文/罗马音) */
  name: string;
  /** 中文名 (可空字符串) */
  name_cn: string;
}

/**
 * 搜索动画条目 (type=2)。
 * 用 POST /v0/search/subjects (架构权威), 返回 top-5 候选。
 * @param keyword 标题关键词 (任意语言)
 */
export async function searchSubjects(keyword: string): Promise<BangumiSearchCandidate[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  try {
    const data = (await bangumiPost('/v0/search/subjects', {
      keyword: trimmed,
      sort: 'match',
      filter: { type: [2] },
    })) as { data?: BangumiRawSubject[] };
    const list = data.data ?? [];
    return list.slice(0, 5).map((d) => ({
      id: d.id,
      name: d.name,
      name_cn: d.name_cn ?? '',
    }));
  } catch (e) {
    logger.warn({ err: (e as Error).message, keyword }, 'bangumi search failed');
    return [];
  }
}

// ============================================================
// 条目详情 + 集表
// ============================================================

/** Bangumi 条目原始字段 (节选)。 */
interface BangumiRawSubject {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  summary?: string;
  nsfw?: boolean;
  locked?: boolean;
  date?: string;
  images?: { large?: string; common?: string; medium?: string };
  infobox?: Array<{ key: string; value: string | Array<{ k: string; v: string }> }>;
  rating?: { score?: number; total?: number };
  eps?: number;
  eps_count?: number;
}

/** 集表原始字段 (节选)。 */
interface BangumiRawEpisode {
  id: number;
  type: number; // 0=正片 1=SP 2=OP 3=ED 4=预告/CM 6=其它
  sort: number; // 条目内序号 (1-based)
  ep?: number; // 全局编号 (可空)
  name?: string;
  name_cn?: string;
  duration?: string;
  airdate?: string;
  comment?: number;
}

/** 规整后的集信息。 */
export interface BangumiEpisode {
  id: number;
  /** 0=正片 1=SP 2=OP 3=ED 4=预告/CM 6=其它 */
  type: number;
  /** 条目内序号 */
  sort: number;
  /** 全局编号 (绝对集, 可空) */
  ep: number | null;
  name: string;
  nameCn: string;
  duration?: string;
  airdate?: string;
}

/** 规整后的条目详情。 */
export interface BangumiSubject {
  id: number;
  name: string;
  nameCn: string;
  summary: string;
  nsfw: boolean;
  date?: string;
  ratingScore?: number;
  ratingTotal?: number;
  epsCount: number;
  poster?: string;
  episodes: BangumiEpisode[];
}

/** Bangumi 集表 type 过滤: 0=正片。 */
export async function getEpisodes(
  subjectId: number,
  type: 0 | 1 | 0 = 0,
): Promise<BangumiEpisode[]> {
  const data = (await bangumiGet(
    `/v0/episodes?subject_id=${subjectId}&type=${type}&limit=200&offset=0`,
  )) as { data?: BangumiRawEpisode[] };
  const list = data.data ?? [];
  return list.map((e) => ({
    id: e.id,
    type: e.type,
    sort: e.sort,
    ep: e.ep ?? null,
    name: e.name ?? '',
    nameCn: e.name_cn ?? '',
    duration: e.duration,
    airdate: e.airdate,
  }));
}

/**
 * 取条目详情 + 正片集表。
 * 中文主键 (name_cn) + 集数映射 (sort/ep) 由调用方据此落库 Series/Episode。
 */
export async function getSubject(subjectId: number): Promise<BangumiSubject> {
  const raw = (await bangumiGet(`/v0/subjects/${subjectId}`)) as BangumiRawSubject;
  const episodes = await getEpisodes(subjectId, 0).catch(() => [] as BangumiEpisode[]);
  return {
    id: raw.id,
    name: raw.name,
    nameCn: raw.name_cn ?? '',
    summary: raw.summary ?? '',
    nsfw: !!raw.nsfw,
    date: raw.date,
    ratingScore: raw.rating?.score,
    ratingTotal: raw.rating?.total,
    epsCount: raw.eps_count ?? raw.eps ?? 0,
    poster: raw.images?.large ?? raw.images?.common,
    episodes,
  };
}

// ============================================================
// 放送日历 (新番发现)
// ============================================================

/** 日历条目 (按星期分组)。 */
export interface CalendarItem {
  weekday: { en: string; cn: string; id: number };
  /** 该星期播出的条目最小投影 */
  items: BangumiSearchCandidate[];
}

const WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 取本季新番日历。
 * 返回按星期分组，items 仅含 {id, name, name_cn} 最小投影。
 */
export async function getCalendar(): Promise<CalendarItem[]> {
  const raw = (await bangumiGet('/calendar')) as Array<{
    weekday: { cn?: string; en?: string; id?: number; ja?: string };
    items?: BangumiRawSubject[];
  }>;
  return raw.map((g) => ({
    weekday: {
      id: g.weekday?.id ?? 0,
      en: g.weekday?.en ?? '',
      cn: g.weekday?.cn ?? (g.weekday?.id != null ? (WEEKDAY_CN[g.weekday.id - 1] ?? '') : ''),
    },
    items: (g.items ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      name_cn: s.name_cn ?? '',
    })),
  }));
}

// ============================================================
// 关系 (多季串联)
// ============================================================

/** 关系原始字段。 */
interface BangumiRawRelation {
  relation: string; // 续集/前传/衍生...
  subject: BangumiRawSubject;
}

export interface BangumiRelation {
  relation: string;
  subjectId: number;
  name: string;
  nameCn: string;
}

/** 取条目关系 (前传/续集/衍生)，用于多季串联。 */
export async function getRelations(subjectId: number): Promise<BangumiRelation[]> {
  const raw = (await bangumiGet(`/v0/subjects/${subjectId}/subjects`)) as BangumiRawRelation[];
  return (raw ?? []).map((r) => ({
    relation: r.relation,
    subjectId: r.subject.id,
    name: r.subject.name,
    nameCn: r.subject.name_cn ?? '',
  }));
}
