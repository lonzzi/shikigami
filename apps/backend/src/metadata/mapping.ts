/**
 * 绝对集号 → 季集映射 (架构 5.3 mapping.ts 修正版)。
 *
 * seasonOffset 语义: 每季首集绝对集号 1-based。
 *   {"1":1,"2":14,"3":26} 表示 S1 从 abs=1, S2 从 abs=14, S3 从 abs=26
 * episode = absolute - firstAbsOfSeason + 1
 *
 * 修正要点 (对齐 ARCHITECTURE.md 5.3):
 *  - 用 `>=` 而非 `>` 比较首集边界
 *  - firstAbsOfSeason 取"当前季自己的 offset"，而非上一季
 *  - 人工覆盖 (EpisodeOverride) 权威优先
 */

export type CourMode = 'split' | 'absolute';

export interface SeasonEpisode {
  season: number;
  episode: number;
}

/** 人工覆盖项: 绝对集号 → {season, episode}。 */
export type SeasonOverrides = Record<number, SeasonEpisode>;

/**
 * 绝对集号 → {season, episode}。
 *
 * 必备单测用例 (覆盖首尾集、跨季, seasonOffset={"1":1,"2":14,"3":26}):
 *   abs=1   → S1E1
 *   abs=13  → S1E13
 *   abs=14  → S2E1   (旧算法会错算成 S2E14 或 S1E13)
 *   abs=25  → S2E12
 *   abs=26  → S3E1
 *   abs=27  → S3E2
 *   overrides={14:{season:99,episode:99}} → abs=14 返回 S99E99
 *
 * @param absolute 字幕组连续集号 (1-based)
 * @param seasonOffset 每季首集绝对集号, key=季号, value=该季首集 abs
 * @param courMode split=每 cour 独立季号 (已在 seasonOffset 体现); absolute=按播出季聚合
 * @param overrides EpisodeOverride 人工覆盖 (权威优先)
 */
export function mapAbsoluteToSeason(
  absolute: number,
  seasonOffset: Record<string, number>,
  courMode: CourMode = 'absolute',
  overrides?: SeasonOverrides,
): SeasonEpisode {
  // 人工覆盖权威优先 (EpisodeOverride 表)
  if (overrides?.[absolute]) return overrides[absolute];

  // 构造 [(season, firstAbs)] 按 firstAbs 升序; 过滤非法 key
  const offsets = Object.entries(seasonOffset)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([s, v]) => Number.isInteger(s) && s >= 1 && Number.isInteger(v) && v >= 1)
    .sort((a, b) => a[1] - b[1]);

  // 无 offset 信息 → 退化为单季
  if (offsets.length === 0) return { season: 1, episode: absolute };

  // 修正逻辑: >= 比较处理首集边界; firstAbsOfSeason 取当前季自己的 offset
  let season = 1;
  let firstAbsOfSeason = offsets[0]![1]; // 默认 S1 起始
  for (const [s, start] of offsets) {
    if (absolute >= start) {
      // 修订: >= 处理首集边界
      season = s;
      firstAbsOfSeason = start;
    } else {
      break;
    }
  }
  const episode = absolute - firstAbsOfSeason + 1;

  // courMode=split 时每 cour 独立季号已在 seasonOffset 体现，无需额外处理。
  // 这里保留参数以对齐契约签名，并标记未使用语义。
  void courMode;

  return { season, episode };
}

/**
 * 从 Episode 列表构造 seasonOffset (每季首集绝对集号)。
 *
 * 输入: 已落库的 Episode 记录 (含 seasonIndex / epInSeason 或 absoluteEpisode)。
 * 输出: { "1": 1, "2": 14, "3": 26 } 形态。
 *
 * 规则: 取每季中绝对集号最小者作为该季 firstAbs。
 *
 * @param episodes Episode 投影: 至少含 seasonIndex + absoluteEpisode
 */
export function buildSeasonOffset(
  episodes: ReadonlyArray<{ seasonIndex: number; absoluteEpisode: number | null }>,
): Record<string, number> {
  const bySeason = new Map<number, number>();

  for (const ep of episodes) {
    if (ep.absoluteEpisode == null) continue;
    const cur = bySeason.get(ep.seasonIndex);
    if (cur === undefined || ep.absoluteEpisode < cur) {
      bySeason.set(ep.seasonIndex, ep.absoluteEpisode);
    }
  }

  const out: Record<string, number> = {};
  for (const [season, firstAbs] of bySeason) {
    out[String(season)] = firstAbs;
  }
  return out;
}
