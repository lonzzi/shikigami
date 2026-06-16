import { sanitizePathSegment } from '../lib/path';
import type { AnimeMeta } from '../llm/schema';

/** rename 只用到 Series/Episode 的少数字段, 本地定义避免强依赖 generated 类型 */
type SeriesLike = { titleCn: string | null; year: number | null };
type EpisodeLike = { seasonIndex: number; epInSeason: number | null; type: number | null };

/**
 * 重命名: 构造媒体库相对路径（架构 5.3 rename.ts）。
 *
 * episode_type 分流:
 *   - type=1 (SPECIAL) / type=2 (OVA) / type=6 (OTHER) → Season 00 / S00E##
 *   - movie (meta.episode_type==='movie') → Movies / <title>
 *   - normal → Season XX / SxxExx
 *
 * 字幕跟随正片 basename + 语言后缀（Jellyfin 自动挂载）；字体归 Fonts 目录（Jellyfin 不识别）。
 */

/** 构造路径时关心的集类型分流标签（对齐 AnimeMeta.episode_type）。 */
export type EpisodePathType = 'normal' | 'special' | 'ova' | 'movie';

/** Episode.type 取值: 0=本篇, 1=SPECIAL(S00E##), 2=OVA, 6=OTHER（对齐 schema.prisma 注释）。 */
const EP_TYPE_SPECIAL = 1;
const EP_TYPE_OVA = 2;
const EP_TYPE_OTHER = 6;

export interface BuildLibraryPathMeta {
  resolution?: string | null;
  fansub?: string | null;
  subtitleLang?: string | null;
  /** episode_type（来自 AI 刮削）；movie 时分流到 Movies 目录。 */
  episode_type?: EpisodePathType;
}

/**
 * 构造媒体库相对路径（不含 LIBRARY_ROOT 前缀）。
 *
 * @param s       Series 子集（titleCn / year）
 * @param ep      Episode 子集（seasonIndex / epInSeason / type）
 * @param meta    刮削 meta（分辨率/字幕组/字幕语言/episode_type）
 * @param ext     扩展名（不含点，如 'mkv'）
 * @param kind    文件类型: video | subtitle | font
 */
export function buildLibraryPath(
  s: SeriesLike,
  ep: EpisodeLike,
  meta: BuildLibraryPathMeta,
  ext: string,
  kind: 'video' | 'subtitle' | 'font' = 'video',
): string {
  // 入口断言: 视频和字幕必须 epInSeason 非空（架构 I10），否则进人工队列
  if (kind !== 'font' && ep.epInSeason == null) {
    throw new Error(`epInSeason required for kind=${kind}`);
  }

  const titleCn = sanitizePathSegment(s.titleCn || 'Unknown');
  const yearStr = s.year ? ` (${s.year})` : '';
  const showDir = `${titleCn}${yearStr}`;

  // ---- 字体: 不入 Season 文件夹，单独归档 ----
  if (kind === 'font') {
    const fontBase = sanitizePathSegment(meta.fansub || 'font');
    return `${showDir}/Fonts/${fontBase}.${ext}`;
  }

  // ---- 按 type 分流目录与文件名 ----
  let seasonFolder: string;
  let fileBase: string;

  const isMovie = meta.episode_type === 'movie';
  const isSeason00 =
    ep.type === EP_TYPE_SPECIAL || ep.type === EP_TYPE_OVA || ep.type === EP_TYPE_OTHER;

  if (isMovie) {
    // 剧场版独立 Movie 目录（不进 Season 结构）
    seasonFolder = 'Movies';
    fileBase = `${titleCn}${yearStr}`;
  } else if (isSeason00) {
    // SPECIAL / OVA / OTHER → Season 00
    seasonFolder = 'Season 00';
    const E = String(ep.epInSeason ?? 0).padStart(2, '0');
    fileBase = `${titleCn}${yearStr} S00E${E}`;
  } else {
    // normal → Season XX
    const S = String(ep.seasonIndex).padStart(2, '0');
    const E = String(ep.epInSeason ?? 0).padStart(2, '0');
    seasonFolder = `Season ${S}`;
    fileBase = `${titleCn}${yearStr} S${S}E${E}`;
  }

  // ---- 字幕: 跟随正片 basename + 语言后缀 ----
  if (kind === 'subtitle') {
    const langSuffix = subtitleLangSuffix(meta.subtitleLang);
    return `${showDir}/${seasonFolder}/${fileBase}${langSuffix}.${ext}`;
  }

  // ---- 视频: 追加 [分辨率][字幕组][语言] tags ----
  const tags = [meta.resolution, meta.fansub, meta.subtitleLang ? langTag(meta.subtitleLang) : null]
    .filter((t): t is string => !!t && t.length > 0)
    .map((t) => `[${t}]`)
    .join('');

  const tagPart = tags ? ` ${tags}` : '';
  return `${showDir}/${seasonFolder}/${fileBase}${tagPart}.${ext}`;
}

// ============================================================
// 语言后缀 / tag 映射（对齐架构 5.3）
// ============================================================

/** 字幕文件名语言后缀: CHS→.zh-CN, CHT→.zh-TW, DUAL→.zh, 其余无后缀。 */
function subtitleLangSuffix(lang?: string | null): string {
  switch (lang) {
    case 'CHS':
      return '.zh-CN';
    case 'CHT':
      return '.zh-TW';
    case 'DUAL':
      return '.zh';
    default:
      return '';
  }
}

/** 视频 tag 内的语言标识: CHS→GB, CHT→BIG5, DUAL→双字。 */
function langTag(lang?: string | null): string | null {
  switch (lang) {
    case 'CHS':
      return 'GB';
    case 'CHT':
      return 'BIG5';
    case 'DUAL':
      return '双字';
    default:
      return null;
  }
}

/**
 * 将 AnimeMeta 转成 buildLibraryPath 所需的 meta 子集。
 * 便利助手，调用方也可自行构造。
 * 注: AnimeMeta.episode_type 多一个 'web'（网络放送），语义等同 normal（按季/集结构），此处归一化。
 */
export function metaForRename(meta: AnimeMeta): BuildLibraryPathMeta {
  return {
    resolution: meta.resolution,
    subtitleLang: meta.subtitle_lang,
    fansub: meta.release_group,
    episode_type: meta.episode_type === 'web' ? 'normal' : meta.episode_type,
  };
}
