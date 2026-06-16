import type { FilterRule, Torrent } from '../scrapers/types';

/**
 * 订阅匹配引擎。
 * 把抓取到的 Torrent 列表按订阅 filterRule 过滤 + 偏好排序，产出待下载的匹配项。
 *
 * 架构 2.2 数据流的"匹配规则"环节。设计为纯函数,便于单测。
 */

export interface MatchResult {
  torrent: Torrent;
  /** 匹配命中的原因（调试/UI 展示） */
  matchedBy: string[];
  /** 偏好评分（越高越优先）。用于同集多源择优。 */
  score: number;
}

/**
 * 判断单个 torrent 是否满足订阅规则，并计算偏好评分。
 */
export function matchTorrent(t: Torrent, rule: FilterRule): MatchResult | null {
  const matchedBy: string[] = [];

  // 1. 来源过滤
  if (rule.sources.length > 0 && !rule.sources.includes(t.source)) return null;

  // 2. 关键词（标题包含）
  if (rule.keyword?.trim()) {
    if (!t.title.includes(rule.keyword.trim())) return null;
    matchedBy.push('keyword');
  }

  // 3. 字幕组白名单（fansub 模糊匹配）
  if (rule.fansubs && rule.fansubs.length > 0) {
    const f = t.fansub ?? '';
    if (!rule.fansubs.some((name) => f.includes(name))) return null;
    matchedBy.push('fansub');
  }

  // 4. 黑名单（标题包含任一黑名单词则排除）
  if (rule.blacklist && rule.blacklist.length > 0) {
    if (rule.blacklist.some((b) => t.title.includes(b))) return null;
  }

  // 5. 语言偏好
  if (rule.preferredLang && rule.preferredLang !== 'ANY') {
    if (t.subtitleLang && t.subtitleLang !== rule.preferredLang) {
      // 不直接拒绝（可能 metadata 漏提取），但降分
    } else if (t.subtitleLang === rule.preferredLang) {
      matchedBy.push('preferredLang');
    }
  }

  // 6. 分辨率最低门槛
  if (rule.resolutionMin) {
    if (!hasResolutionAtLeast(t.title, rule.resolutionMin)) return null;
    matchedBy.push('resolutionMin');
  }

  // 7. 偏好评分
  let score = 0;
  if (t.subtitleLang === rule.preferredLang) score += 10;
  const res = detectResolution(t.title);
  if (res === '2160p') score += 5;
  else if (res === '1080p') score += 3;
  else if (res === '720p') score += 1;
  if (matchedBy.includes('fansub')) score += 2;

  return { torrent: t, matchedBy, score };
}

/**
 * 对一批 torrents 按规则匹配，并按 (集号, 偏好评分) 去重择优。
 * 同一集号（由调用方解析）只保留最高分源。
 */
export function matchAndRank(torrents: Torrent[], rule: FilterRule): MatchResult[] {
  const matched: MatchResult[] = [];
  for (const t of torrents) {
    const r = matchTorrent(t, rule);
    if (r) matched.push(r);
  }
  matched.sort((a, b) => b.score - a.score);
  return matched;
}

const RES_ORDER: Record<string, number> = { '480p': 1, '720p': 2, '1080p': 3, '2160p': 4 };

export function detectResolution(title: string): string | null {
  const m = title.match(/\b(2160p|1080p|720p|480p)\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

function hasResolutionAtLeast(title: string, min: string): boolean {
  const got = detectResolution(title);
  if (!got) return true; // 没标注分辨率不拦（兼容）
  return (RES_ORDER[got] ?? 0) >= (RES_ORDER[min] ?? 0);
}
