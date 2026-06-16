import type { AnimeMeta } from '../llm/schema';

/**
 * 轻量 anitomy-like 解析器 (架构 5.2 anitomy.ts)。
 *
 * 不引入外部 npm 库，纯 TS 正则实现，接口保持稳定。
 * 解析 [release_group] Title - XX [resolution][codec] 结构，输出 Partial<AnimeMeta>。
 *
 * 字段映射对齐 AnimeMeta: release_group / title_hint / season / episode /
 * absolute_episode / resolution / source / video_codec / audio_codec / checksum。
 * 中文 / 罗马音 / 英文混合尽量解析；不确定的字段不填 (保持 undefined)。
 */

type EpisodeType = AnimeMeta['episode_type'];

/** 分辨率: 2160p/1080p/720p ... + Hi10P/Hi444PP */
const RES_RE = /\b(2160p|1440p|1080p|720p|576p|480p|360p|4K|Hi10P|Hi10|Hi444PP)\b/i;
/** 片源: BDRip/Blu-ray/Web-DL/HDTV/Remux ... */
const SOURCE_RE =
  /\b(BD-?Rip|Blu-?Ray|BDR|WEB-?DL|WebRip|WEB-?Rip|HDTV|DVDRip|DVD-?Rip|TVRip|Remux|HDiTunes|Netflix|NF)\b/i;
/** 视频编码: H.264/H.265/HEVC/x264/x265/AV1/AVC/VP9/DivX/XviD */
const VCODEC_RE = /\b(H\.?26[45]|HEVC|AVC|x26[45]|AV1|VP9|DivX|XviD|MPEG-?[24])\b/i;
/** 音频编码: AAC/FLAC/AC3/EAC3/TrueHD/DTS/Opus ... */
const ACODEC_RE =
  /\b(AAC(?:[ .]\d[ .]\d)?|FLAC|AC-?3|E-?AC-?3|DDP|DD\+|TrueHD|DTS-?HD|DTS|Opus|MP3|L?PCM)\b/i;
/** 8 位 CRC32 校验码: [AABBCCDD] */
const CHECKSUM_RE = /\[([0-9A-Fa-f]{8})\]/;

/** SxxExx / S00E00 → 季 + 集 */
const SXXEYY_RE = /S(\d{1,2})\s*E(\d{1,3})/i;
/** 第X季 (含中文数字) */
const SEASON_CN_RE = /第\s*([零一二三四五六七八九十百\d]{1,4})\s*季/;
/** Season N / Series N */
const SEASON_EN_RE = /\b(?:Season|Series)\s*(\d{1,2})\b/i;
/** 罗马数字季 Ⅱ/III/IV (出现在标题尾部) */
const SEASON_ROMAN_RE = /[\s_]+(?:Ⅱ|II|Ⅲ|III|Ⅳ|IV)\b/;

/** 中文集数: 第X集/话/話 / 第X话 */
const EP_CN_RE = /第\s*(\d{1,3})\s*[集话話]/;
/** EP.N / EP.N / Episode N */
const EP_EN_RE = /\bEP(?:ISODE)?\.?\s*(\d{1,3})(v\d+)?\b/i;
/** " - 01" / "- 01v2" / "- 01-12" */
const EP_DASH_RE = /[-\s]\s*(\d{1,3})(?:v(\d+))?(?:\s*-\s*\d{1,3})?\s*$/;
/** 尾部裸集号 " Title 01" / "01v2" */
const EP_TAIL_RE = /[\s._](\d{1,3})(v\d+)?\s*$/;

/** 剧场版标记 */
const MOVIE_RE = /剧场版|劇場版|GEKIJOUBAN|The Movie|\bMovie\b/i;
/** OVA/OAD 标记 */
const OVA_RE = /\b(OVA|OAD)\b/i;
/** SP/SPECIAL/PV/CM 标记 */
const SP_RE = /\b(SP|SPECIAL|PV|CM|MENU|NCED|NCOP)\b/i;
/** WEB 番标记 */
const WEB_RE = /\bWEB(?:-?DL)?\b/i;

/**
 * 主入口: 启发式解析文件名。
 * @returns Partial<AnimeMeta> | null (null 仅当输入为空)
 */
export function parse(filename: string): Partial<AnimeMeta> | null {
  if (!filename?.trim()) return null;

  const meta: Partial<AnimeMeta> = {};
  const rawTokens: Record<string, string> = {};

  // 0. 去扩展名
  let work = stripExt(filename);

  // 1. 校验码 (最先抽走，避免被当成集号)
  const ck = work.match(CHECKSUM_RE);
  if (ck?.[1]) {
    meta.checksum = ck[1].toUpperCase();
    rawTokens.checksum = ck[1];
    work = work.replace(ck[0], ' ');
  }

  // 2. 收集所有 [..] / 【..】 / (..) 括号组 → 第一个"非技术性"括号即 release_group
  const brackets: string[] = [];
  work = work.replace(/[[【（(]([^】\]）)]+)[】\]）)]/g, (_m, g: string) => {
    brackets.push(g);
    return ' ';
  });

  for (const b of brackets) {
    const t = b.trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) continue; // 纯数字 (集号括号)
    if (RES_RE.test(t) || VCODEC_RE.test(t) || ACODEC_RE.test(t) || SOURCE_RE.test(t)) continue;
    if (/^(chs|cht|chi|jpn|eng|dual|gb|big5|sc|tc)\b/i.test(t)) continue; // 语言标签
    // 字幕组名通常是一个 token (可能含空格，取整段去多余空白)
    meta.release_group = t.replace(/\s+/g, ' ').trim();
    rawTokens.release_group = t;
    break;
  }

  // 3. 从"所有括号 + 剩余文本"池里抽技术字段
  const techPool = `${brackets.join(' ')} ${work}`;
  const res = techPool.match(RES_RE);
  if (res) {
    meta.resolution = normRes(res[0]);
    rawTokens.resolution = res[0];
    work = stripMatch(work, RES_RE);
  }
  const src = techPool.match(SOURCE_RE);
  if (src) {
    meta.source = normSource(src[0]);
    rawTokens.source = src[0];
    work = stripMatch(work, SOURCE_RE);
  }
  const vc = techPool.match(VCODEC_RE);
  if (vc) {
    meta.video_codec = normVCodec(vc[0]);
    rawTokens.video_codec = vc[0];
    work = stripMatch(work, VCODEC_RE);
  }
  const ac = techPool.match(ACODEC_RE);
  if (ac) {
    meta.audio_codec = normACodec(ac[0]);
    rawTokens.audio_codec = ac[0];
    work = stripMatch(work, ACODEC_RE);
  }

  // 4. episode_type 判定 (优先级: movie > ova > special > web > normal)
  meta.episode_type = detectEpisodeType(work);

  // 5. SxxExx → season + episode (最权威，先判)
  const se = work.match(SXXEYY_RE);
  if (se) {
    const s = toInt(se[1]);
    const e = toInt(se[2]);
    if (s && e) {
      meta.season = s;
      meta.episode = e;
      work = work.replace(se[0], ' ');
    }
  }

  // 6. season 单独标记
  if (meta.season == null) {
    const scn = work.match(SEASON_CN_RE);
    if (scn?.[1]) {
      const s = toChineseInt(scn[1]) ?? toInt(scn[1]);
      if (s) {
        meta.season = s;
        work = work.replace(scn[0], ' ');
      }
    }
  }
  if (meta.season == null) {
    const sen = work.match(SEASON_EN_RE);
    if (sen) {
      const s = toInt(sen[1]);
      if (s) {
        meta.season = s;
        work = work.replace(sen[0], ' ');
      }
    }
  }
  // 罗马数字季标记 (不抽具体值，仅提示多季 → 让 AI 仲裁)
  if (meta.season == null && SEASON_ROMAN_RE.test(work)) {
    rawTokens.season_roman = 'multi';
  }

  // 7. 集号 (若 SxxExx 已给出则跳过)
  if (meta.episode == null) {
    const ep = extractEpisode(work);
    if (ep) {
      meta.episode = ep.number;
      if (ep.version) rawTokens.episode_version = ep.version;
      work = work.replace(ep.raw, ' ');
    }
  }

  // 8. absolute_episode: 无明确季拆分时，集号即字幕组连续编号
  if (meta.episode != null && meta.season == null) {
    meta.absolute_episode = meta.episode;
  }

  // 9. title_hint = 清理后剩余
  const title = cleanTitle(work);
  if (title) {
    meta.title_hint = title;
    rawTokens.title = title;
  }

  // raw_tokens 仅在有解析产出时附加
  if (Object.keys(rawTokens).length > 0) {
    meta.raw_tokens = rawTokens;
  }

  return meta;
}

// ============================================================
// 内部辅助
// ============================================================

/** 去掉文件扩展名 (末尾 .ext)。 */
function stripExt(name: string): string {
  const m = name.match(/^(.+)\.[a-z0-9]{2,4}$/i);
  return m?.[1] ? m[1] : name;
}

/** 从 work 中移除某正则的首个匹配 (用于清理标题)。 */
function stripMatch(s: string, re: RegExp): string {
  return s.replace(re, ' ');
}

/** 安全转正整数 (>0)。 */
function toInt(s: string | undefined | null): number | null {
  if (s == null || s === '') return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 中文数字 (含混合如 "十几"/"二十") → int；失败返回 null。 */
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
  // "二十一" 等: 十位 + 个位
  const m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])$/);
  if (m?.[1] && m[2]) return map[m[1]]! * 10 + map[m[2]]!;
  if (s in map) return map[s]!;
  return null;
}

/** 抽取集号 (依次尝试: 第X集 → EP → - NN → 尾部裸号)。 */
function extractEpisode(s: string): { number: number; version?: string; raw: string } | null {
  const cn = s.match(EP_CN_RE);
  if (cn?.[1]) {
    const n = toInt(cn[1]);
    if (n) return { number: n, raw: cn[0] };
  }
  const en = s.match(EP_EN_RE);
  if (en?.[1]) {
    const n = toInt(en[1]);
    if (n) return { number: n, version: en[2] ?? undefined, raw: en[0] };
  }
  const dash = s.match(EP_DASH_RE);
  if (dash?.[1]) {
    const n = toInt(dash[1]);
    if (n) return { number: n, version: dash[2] ?? undefined, raw: dash[0] };
  }
  const tail = s.match(EP_TAIL_RE);
  if (tail?.[1]) {
    const n = toInt(tail[1]);
    if (n) {
      const ver = tail[2] ?? undefined;
      return { number: n, version: ver, raw: tail[0] };
    }
  }
  return null;
}

/** episode_type 判定。 */
function detectEpisodeType(s: string): EpisodeType {
  if (MOVIE_RE.test(s)) return 'movie';
  if (OVA_RE.test(s)) return 'ova';
  if (SP_RE.test(s)) return 'special';
  if (WEB_RE.test(s)) return 'web';
  return 'normal';
}

/** 标题清理: 下划线转空格、去残留括号/分隔符、折叠空白。 */
function cleanTitle(s: string): string {
  let t = s.replace(/[_]/g, ' ');
  t = t.replace(/[[\]【】（）(){}<>「」『』]/g, ' ');
  t = t.replace(/\s*[-–—]\s*$/g, ' '); // 去尾部 dash (集号已抽走)
  t = t.replace(/\s{2,}/g, ' ').trim();
  // 去首尾非字母数字中日韩分隔
  t = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return t;
}

/** 分辨率归一化。 */
function normRes(s: string): string {
  const u = s.toUpperCase();
  if (u === '4K') return '2160p';
  if (u === 'HI10' || u === 'HI10P') return '1080p';
  return u.toLowerCase();
}

/** 片源归一化。 */
function normSource(s: string): string {
  const u = s.toUpperCase().replace(/[-_\s]/g, '');
  if (/^BD(RIP)?/.test(u) || /^BLURAY/.test(u)) return 'BDRip';
  if (/^WEB(DL|RIP)?/.test(u)) return 'WEB-DL';
  if (/^DVD/.test(u)) return 'DVDRip';
  if (/^HDTV/.test(u)) return 'HDTV';
  if (/^REMUX/.test(u)) return 'Remux';
  if (/^NF|NETFLIX/.test(u)) return 'Netflix';
  return s.toUpperCase();
}

/** 视频编码归一化。 */
function normVCodec(s: string): string {
  const u = s.toUpperCase();
  if (/H\.?26[45]/.test(u) || u === 'HEVC')
    return u.startsWith('H.265') || u === 'HEVC' ? 'HEVC' : u.replace('.', '');
  return u;
}

/** 音频编码归一化。 */
function normACodec(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '');
}
