import { describe, expect, it } from 'bun:test';
import { buildMagnet, parseSizeText } from '../src/scrapers/normalize';
import { detectSubtitleLang, parseInfoHash } from '../src/scrapers/types';

describe('parseInfoHash', () => {
  it('从 magnet 提取 40 位 hex（大写）', () => {
    const magnet = 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=test';
    expect(parseInfoHash(magnet)).toBe('ABCDEF0123456789ABCDEF0123456789ABCDEF01');
  });
  it('base32 btih 自动转 hex（qB v5 不认 base32）', () => {
    const b32 = '4FEREWEBCQDP6FNN722JZLEH6W6WMNTC'; // 石纪元真实 hash
    const magnet = `magnet:?xt=urn:btih:${b32}&dn=test`;
    const hex = parseInfoHash(magnet)!;
    expect(hex).toMatch(/^[a-f0-9]{40}$/); // 40 位小写 hex
    expect(hex).toBe('e1491258811406ff15adfeb49cac87f5bd663662');
  });
  it('无 btih → undefined', () => {
    expect(parseInfoHash('magnet:?dn=test')).toBeUndefined();
  });
});

describe('detectSubtitleLang', () => {
  it('识别简体', () => {
    expect(detectSubtitleLang('[ANi] 番名 01 [GB][1080p]')).toBe('CHS');
    expect(detectSubtitleLang('番名 简体内嵌')).toBe('CHS');
  });
  it('识别繁体', () => {
    expect(detectSubtitleLang('[番名] 01 [BIG5]')).toBe('CHT');
    expect(detectSubtitleLang('番名 繁体')).toBe('CHT');
  });
  it('识别双语', () => {
    expect(detectSubtitleLang('番名 01 [双字]')).toBe('DUAL');
    expect(detectSubtitleLang('番名 双语')).toBe('DUAL');
  });
  it('无标识 → undefined', () => {
    expect(detectSubtitleLang('番名 01 [1080p]')).toBeUndefined();
  });
});

describe('parseSizeText', () => {
  it('解析 GB', () => {
    expect(parseSizeText('1.2 GB')).toBe(1200000000n);
  });
  it('解析 MB', () => {
    expect(parseSizeText('500 MB')).toBe(500000000n);
  });
  it('解析数字', () => {
    expect(parseSizeText(123456)).toBe(123456n);
  });
  it('无效 → undefined', () => {
    expect(parseSizeText('abc')).toBeUndefined();
  });
});

describe('buildMagnet', () => {
  it('拼接 magnet 含 tracker', () => {
    const m = buildMagnet('ABC123');
    expect(m.startsWith('magnet:?xt=urn:btih:ABC123')).toBe(true);
    expect(m).toContain('tr=');
  });
});
