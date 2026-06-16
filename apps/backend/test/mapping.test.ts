import { describe, expect, it } from 'bun:test';
import { mapAbsoluteToSeason } from '../src/metadata/mapping';

/**
 * 绝对集 → 季集映射算法测试。
 * 架构 5.3 列出的必备单测用例（修正算法）。
 */
describe('mapAbsoluteToSeason', () => {
  const offsets = { '1': 1, '2': 14, '3': 26 };

  it('abs=1 → S1E1', () => {
    expect(mapAbsoluteToSeason(1, offsets)).toEqual({ season: 1, episode: 1 });
  });

  it('abs=13 → S1E13（S1 末集）', () => {
    expect(mapAbsoluteToSeason(13, offsets)).toEqual({ season: 1, episode: 13 });
  });

  it('abs=14 → S2E1（跨季边界，修订前会错算）', () => {
    expect(mapAbsoluteToSeason(14, offsets)).toEqual({ season: 2, episode: 1 });
  });

  it('abs=25 → S2E12', () => {
    expect(mapAbsoluteToSeason(25, offsets)).toEqual({ season: 2, episode: 12 });
  });

  it('abs=26 → S3E1', () => {
    expect(mapAbsoluteToSeason(26, offsets)).toEqual({ season: 3, episode: 1 });
  });

  it('abs=27 → S3E2', () => {
    expect(mapAbsoluteToSeason(27, offsets)).toEqual({ season: 3, episode: 2 });
  });

  it('空 offset → 默认 S1，episode=abs', () => {
    expect(mapAbsoluteToSeason(5, {})).toEqual({ season: 1, episode: 5 });
  });

  it('人工覆盖权威优先', () => {
    const overrides = { 14: { season: 99, episode: 99 } };
    expect(mapAbsoluteToSeason(14, offsets, 'absolute', overrides)).toEqual({
      season: 99,
      episode: 99,
    });
  });

  it('abs 小于首季起点时仍归 S1', () => {
    // 非常规 offset，首季从 3 开始
    expect(mapAbsoluteToSeason(3, { '1': 3 })).toEqual({ season: 1, episode: 1 });
  });
});
