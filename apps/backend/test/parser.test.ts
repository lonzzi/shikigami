import { describe, expect, it } from 'bun:test';
import { parse } from '../src/parser/anitomy';
import { scoreByCompleteness } from '../src/parser/confidence';
import { regexChinese } from '../src/parser/regex-cn';

describe('anitomy parse', () => {
  it('标准英文命名 [group] Title - 01 [1080p]', () => {
    const r = parse('[ANi] Frieren - 01 [1080p][CHT].mkv');
    expect(r).not.toBeNull();
    expect(r!.release_group).toBe('ANi');
    expect(r!.episode).toBe(1);
    expect(r!.resolution).toBe('1080p');
    expect(r!.title_hint).toContain('Frieren');
  });

  it('带版本号 v2', () => {
    const r = parse('[SubsPlease] Title - 05v2 (1080p).mkv');
    expect(r).not.toBeNull();
    expect(r!.episode).toBe(5);
    expect(r!.resolution).toBe('1080p');
  });

  it('季番 SxxExx', () => {
    const r = parse('Title S02E03 [1080p].mkv');
    expect(r).not.toBeNull();
    if (r!.season) expect(r!.season).toBe(2);
    expect(r!.episode).toBe(3);
  });

  it('无字幕组也能解析', () => {
    const r = parse('Title - 12 [720p].mkv');
    expect(r).not.toBeNull();
    expect(r!.episode).toBe(12);
  });
});

describe('regexChinese', () => {
  it('【字幕组】格式', () => {
    const r = regexChinese('【ANIME】番名 第03话 [1080P]');
    expect(r).not.toBeNull();
  });
  it('中文番名 + 集数', () => {
    const r = regexChinese('番名 第5集.mp4');
    expect(r).not.toBeNull();
    if (r!.episode) expect(r!.episode).toBe(5);
  });
});

describe('scoreByCompleteness', () => {
  it('关键字段齐全 → 高分（≥0.7）', () => {
    const score = scoreByCompleteness({ release_group: 'ANi', episode: 1, resolution: '1080p' });
    expect(score).toBeGreaterThanOrEqual(0.7);
  });
  it('缺关键字段 → 低分', () => {
    const score = scoreByCompleteness({ resolution: '1080p' });
    expect(score).toBeLessThan(0.5);
  });
  it('release_group + episode 必备', () => {
    const withCritical = scoreByCompleteness({ release_group: 'X', episode: 1 });
    const without = scoreByCompleteness({ release_group: 'X' });
    expect(withCritical).toBeGreaterThan(without);
  });
});
