import type { AnimeMeta } from '../llm/schema';

/**
 * 字段完整度评分 (架构 5.2 confidence.ts)。
 *
 * anitomy 类解析器输出是确定性的，没有 confidence 概念；本函数为三段式入口
 * 提供一个"可比较的"启发式分数，让 AI 兜底仲裁与快路径用同一把尺子。
 *
 * 评分规则 (严格对齐 ARCHITECTURE.md 5.2):
 *  - 统计 5 个关键字段命中数: release_group / season / episode / resolution / video_codec
 *  - base = 命中数 / 5
 *  - 关键字段加权: release_group 且 (episode 或 absolute_episode) 同时存在 → 至少 0.7
 *  - 缺关键字段 → base * 0.5 (低置信，交给 AI 仲裁)
 */
export function scoreByCompleteness(partial: Partial<AnimeMeta>): number {
  const keys = ['release_group', 'season', 'episode', 'resolution', 'video_codec'] as const;

  const present = keys.filter((k) => partial[k] != null && partial[k] !== '').length;

  // 关键字段: release_group + (episode 或 absolute_episode) 是"可信快路径"的必要条件
  const hasCritical =
    !!partial.release_group && (partial.episode != null || partial.absolute_episode != null);

  const base = present / keys.length;
  return hasCritical ? Math.max(base, 0.7) : base * 0.5;
}
