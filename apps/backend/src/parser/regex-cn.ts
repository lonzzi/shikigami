import type { AnimeMeta } from '../llm/schema';

/**
 * 中文 fansub 命名正则 fallback (架构 5.2 regex-cn.ts)。
 *
 * 处理 anitomy 不擅长的中文/中日混排命名，典型形态:
 *   【字幕组】标题 第13集
 *   [字幕组] 番名 01v2
 *   字幕组★番名 第01话 [1080p][GB]
 *   番名 第二季 05
 *
 * 返回 Partial<AnimeMeta>，fansub 字段映射到 release_group。
 * 仅当文件名"看起来像中文 fansub 命名"时介入，否则返回 null 让 anitomy 处理。
 */

/** 字幕组前缀: 【..】/ [..] / （..） 在串首 */
const FANSUB_RE = /^[【[]([^】\]]{1,40})[】\]]/;
/** "字幕组★" / "字幕组:" 这种无括号前缀 */
const FANSUB_BARE_RE = /^([一-鿿A-Za-z0-9]{2,20}?)\s*[★☆◆◇·:：]/;
/** 中文集数: 第13集 / 第13话 / 第13話 */
const EP_CN_RE = /第\s*(\d{1,3})\s*[集话話]/;
/** "更新至13集" / "第13集" */
const EP_UPDATE_RE = /更新至\s*(\d{1,3})/;
/** 裸集号 + 中文量词: "13集" / "13话" / "13話" (避免误抓年份) */
const EP_NUM_CN_RE = /[^\d](\d{1,3})\s*[集话話]/;
/** EP/EPISODE (中文区也常用) */
const EP_EN_RE = /\bEP(?:ISODE)?\.?\s*(\d{1,3})(v\d+)?\b/i;
/** 尾部裸集号 " 番名 01" / "01v2" */
const EP_TAIL_RE = /[\s._](\d{1,3})(v\d+)?\s*$/;
/** 第X季 (中文数字) */
const SEASON_CN_RE = /第\s*([零一二三四五六七八九十百\d]{1,4})\s*季/;
/** Roman/数字季后缀: 第二季/Ⅱ/2期 */
const SEASON_SUFFIX_RE = /第\s*([一二三四五六七八九十\d]+)\s*[期季]/;

/** 简中 */
const CHS_RE = /\b(简体|简中|GB|CHS|SC)\b/i;
/** 繁中 */
const CHT_RE = /\b(繁体|繁中|BIG5|CHT|TC)\b/i;
/** 双语 */
const DUAL_RE = /\b(简繁|繁简|双语|DUAL|GB&BIG5)\b/i;

/** 分辨率 */
const RES_RE = /\b(2160p|1080p|720p|576p|480p|360p|4K)\b/i;

/**
 * 中文 fansub 命名解析。
 * @returns Partial<AnimeMeta> | null (非中文命名返回 null)
 */
export function regexChinese(filename: string): Partial<AnimeMeta> | null {
  if (!filename?.trim()) return null;

  // 仅当出现中文 / 【】 / "第X集" 等中文 fansub 特征时介入
  const looksCn =
    /[一-鿿]/.test(filename) || /第\s*\d+\s*[集话話]/.test(filename) || /^[【[]/.test(filename);
  if (!looksCn) return null;

  const meta: Partial<AnimeMeta> = {};
  const rawTokens: Record<string, string> = {};

  let work = filename;
  // 去扩展名
  const extM = work.match(/^(.+)\.[a-z0-9]{2,4}$/i);
  if (extM?.[1]) work = extM[1];

  // 1. 字幕组 → release_group
  const fan = work.match(FANSUB_RE) ?? work.match(FANSUB_BARE_RE);
  if (fan?.[1]) {
    const group = fan[1].trim();
    if (group && !/^\d+$/.test(group)) {
      meta.release_group = group;
      rawTokens.fansub = group;
      work = work.replace(fan[0], ' ');
    }
  }

  // 2. 分辨率
  const res = work.match(RES_RE);
  if (res) {
    meta.resolution = res[0].toUpperCase() === '4K' ? '2160p' : res[0].toLowerCase();
    work = work.replace(res[0], ' ');
  }

  // 3. 字幕语言
  if (DUAL_RE.test(work)) {
    meta.subtitle_lang = 'DUAL';
  } else if (CHS_RE.test(work)) {
    meta.subtitle_lang = 'CHS';
  } else if (CHT_RE.test(work)) {
    meta.subtitle_lang = 'CHT';
  }

  // 4. 季 (中文数字)
  const scn = work.match(SEASON_CN_RE) ?? work.match(SEASON_SUFFIX_RE);
  if (scn?.[1]) {
    const s = toChineseInt(scn[1]) ?? toInt(scn[1]);
    if (s) {
      meta.season = s;
      work = work.replace(scn[0], ' ');
    }
  }

  // 5. 集号 (依次尝试多种中文形态)
  const ep =
    work.match(EP_CN_RE) ??
    work.match(EP_UPDATE_RE) ??
    work.match(EP_EN_RE) ??
    work.match(EP_NUM_CN_RE) ??
    work.match(EP_TAIL_RE);
  if (ep?.[1]) {
    const n = toInt(ep[1]);
    if (n) {
      meta.episode = n;
      // 无季拆分时集号即连续编号
      if (meta.season == null) meta.absolute_episode = n;
      if (ep[2]) rawTokens.episode_version = ep[2];
      work = work.replace(ep[0], ' ');
    }
  }

  // 6. episode_type: OVA/剧场版/SP 标记
  if (/剧场版|劇場版|电影/.test(work)) meta.episode_type = 'movie';
  else if (/\bOVA\b|\bOAD\b/.test(work)) meta.episode_type = 'ova';
  else if (/\b(SP|特别篇|特別篇|SPECIAL)\b/.test(work)) meta.episode_type = 'special';

  // 7. title_hint = 清理后剩余
  const title = cleanTitle(work);
  if (title) {
    meta.title_hint = title;
    rawTokens.title = title;
  }

  if (Object.keys(rawTokens).length > 0) {
    meta.raw_tokens = rawTokens;
  }

  return meta;
}

// ============================================================
// 内部辅助
// ============================================================

function toInt(s: string | undefined | null): number | null {
  if (s == null || s === '') return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toChineseInt(s: string): number | null {
  const map: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (!s) return null;
  if (/^\d+$/.test(s)) return toInt(s);
  if (s === '十') return 10;
  if (s.startsWith('十')) {
    const rest = s.slice(1);
    return rest in map ? 10 + map[rest]! : null;
  }
  if (s.endsWith('十')) {
    const head = s.slice(0, -1);
    return head in map ? map[head]! * 10 : null;
  }
  const m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])$/);
  if (m?.[1] && m[2]) return map[m[1]]! * 10 + map[m[2]]!;
  if (s in map) return map[s]!;
  return null;
}

function cleanTitle(s: string): string {
  let t = s.replace(/[_]/g, ' ');
  t = t.replace(/[【】[\]（）(){}<>「」『』★☆◆◇·:：]/g, ' ');
  t = t.replace(/\s*[-–—]\s*$/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return t;
}
