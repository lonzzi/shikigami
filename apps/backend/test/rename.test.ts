import { describe, expect, it } from 'bun:test';
import type { AnimeMeta } from '../src/llm/schema';
import { buildLibraryPath, metaForRename } from '../src/media/rename';

const series = { titleCn: '葬送的芙莉莲', year: 2023 } as const;

describe('buildLibraryPath', () => {
  it('正片 → Season XX / SxxExx', () => {
    const p = buildLibraryPath(
      series,
      { seasonIndex: 1, epInSeason: 3, type: 0 },
      { resolution: '1080p', fansub: 'ANi', subtitleLang: 'CHT' },
      'mkv',
    );
    expect(p).toContain('葬送的芙莉莲 (2023)');
    expect(p).toContain('Season 01');
    expect(p).toContain('葬送的芙莉莲 (2023) S01E03');
    expect(p).toContain('[1080p]');
    expect(p).toContain('[ANi]');
    expect(p.endsWith('.mkv')).toBe(true);
  });

  it('SPECIAL → Season 00', () => {
    const p = buildLibraryPath(series, { seasonIndex: 1, epInSeason: 1, type: 1 }, {}, 'mkv');
    expect(p).toContain('Season 00');
    expect(p).toContain('S00E01');
  });

  it('movie → Movies 目录', () => {
    const p = buildLibraryPath(
      series,
      { seasonIndex: 1, epInSeason: 1, type: 0 },
      { episode_type: 'movie' as const },
      'mkv',
    );
    expect(p).toContain('Movies');
    expect(p).not.toContain('S00E');
  });

  it('字幕跟随正片 basename + 语言后缀', () => {
    const p = buildLibraryPath(
      series,
      { seasonIndex: 2, epInSeason: 5, type: 0 },
      { subtitleLang: 'CHS' },
      'ass',
      'subtitle',
    );
    expect(p).toContain('Season 02');
    expect(p).toContain('S02E05');
    expect(p).toContain('.zh-CN.ass');
  });

  it('字体归 Fonts 目录', () => {
    const p = buildLibraryPath(
      series,
      { seasonIndex: 1, epInSeason: 1, type: 0 },
      { fansub: 'ANi' },
      'ttf',
      'font',
    );
    expect(p).toContain('Fonts');
    expect(p.endsWith('ANi.ttf')).toBe(true);
  });

  it('视频/字幕缺 epInSeason 抛错', () => {
    expect(() =>
      buildLibraryPath(
        series,
        { seasonIndex: 1, epInSeason: null as unknown as number, type: 0 },
        {},
        'mkv',
      ),
    ).toThrow();
  });
});

describe('metaForRename', () => {
  it('映射 AnimeMeta → rename meta', () => {
    const meta = {
      release_group: 'ANi',
      title_hint: 'Frieren',
      season: null,
      episode: 1,
      absolute_episode: 14,
      episode_type: 'normal' as const,
      resolution: '1080p',
      source: null,
      video_codec: null,
      audio_codec: null,
      subtitle_lang: 'CHT',
      audio_lang: null,
      checksum: null,
      release_date: null,
      confidence: 0.9,
      needs_review: false,
    } satisfies AnimeMeta;
    const m = metaForRename(meta);
    expect(m.fansub).toBe('ANi');
    expect(m.resolution).toBe('1080p');
    expect(m.subtitleLang).toBe('CHT');
    expect(m.episode_type).toBe('normal');
  });

  it('web 归一化为 normal', () => {
    const m = metaForRename({ ...(null as unknown as AnimeMeta), episode_type: 'web' });
    expect(m.episode_type).toBe('normal');
  });
});
