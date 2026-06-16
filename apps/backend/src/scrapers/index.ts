/**
 * 抓取层 registry: SiteSource → SiteAdapter。
 *
 * 架构 5.1: 单点入口，调度层/订阅引擎/回填逻辑通过 getAdapter(source) 拿适配器。
 * 严格只用契约清单里的符号。
 *
 * 用法:
 *   import { getAdapter, registry } from '../scrapers';
 *   const adapter = getAdapter('dmhy');
 *   const items = await adapter.fetchLatest();
 *
 * backfill.ts 里按 rule.sources 遍历 registry。
 */

import { bangumimoeAdapter } from './bangumimoe';
import { dmhyAdapter } from './dmhy';
import { mikanAdapter } from './mikan';
import { nyaaAdapter } from './nyaa';
import type { SiteAdapter, SiteSource } from './types';

/**
 * 全站适配器注册表。
 * key 必须覆盖 SiteSource 联合类型的所有分支（TS 会校验 Record 完整性）。
 */
export const registry: Record<SiteSource, SiteAdapter> = {
  dmhy: dmhyAdapter,
  mikan: mikanAdapter,
  nyaa: nyaaAdapter,
  bangumimoe: bangumimoeAdapter,
};

/**
 * 按 SiteSource 取适配器。
 * 未知 source 抛错（防御性: TS 已校验 SiteSource 字面量，运行期兜底）。
 */
export function getAdapter(source: SiteSource): SiteAdapter {
  const adapter = registry[source];
  if (!adapter) throw new Error(`unknown site source: ${source}`);
  return adapter;
}

/** 列出所有已注册源（便于诊断/健康检查）。 */
export function listSources(): SiteSource[] {
  return Object.keys(registry) as SiteSource[];
}

export type { FilterRule, SiteAdapter, SiteSource, Torrent } from './types';
// 再导出各适配器 + 类型，统一外部入口
export { bangumimoeAdapter, dmhyAdapter, mikanAdapter, nyaaAdapter };
